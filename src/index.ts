import express = require("express");
import dotenv from "dotenv";
import * as mongo from "mongodb";
import Ride, { MetaData } from "./ride";
import { GridFSBucket, GridFSBucketWriteStream, ObjectId } from "mongodb";
import { parseGpx } from "./gpxParser";

const crypto = require("crypto");
const fileUpload = require("express-fileupload");

const passport = require("passport");
const BearerStrategy = require("passport-http-bearer");

dotenv.config();

const { OAuth2Client } = require("google-auth-library");
const oAuth2Client = new OAuth2Client(process.env.CLIENT_ID);

const { buildGPX, Esk8palBuilder } = require("gpx-builder");
const parse = require("csv-parse/lib/sync");
const { Point } = Esk8palBuilder.MODELS;
const gpxData = new Esk8palBuilder();

const streamToString = require("stream-to-string");

const app: express.Application = express();

declare module "express" {
  export interface Request {
    user: any;
    files: any;
  }
}

app.use(express.json());
app.use(
  express.urlencoded({
    extended: true,
    limit: "100mb",
    parameterLimit: 1000000,
  })
);

app.use(
  fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 },
  })
);

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});
app.use(passport.initialize());

(async () => {
  const client: mongo.MongoClient = await mongo.connect("mongodb://127.0.0.1:27017", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  const db = client.db("esk8pal");
  const rides = db.collection("rides");
  const users = db.collection("users");

  let gridfsBucket = new GridFSBucket(db, { bucketName: "esk8pal" });

  const generateGpx = (data: string) => {
    const records = parse(data, {
      columns: true,
      from_line: 1,
    });

    const points = records.map((rec: any) => {
      return new Point(rec.latitude, rec.longitude, {
        time: new Date(parseInt(rec.timestamp) * 1000),
        altitude: rec.altitude,
        speed: rec.speed,
        voltage: rec.voltage,
        current: rec.current,
        used_energy: rec.used_energy,
        trip_distance: rec.trip_distance,
      });
    });

    gpxData.setSegmentPoints(points);

    return buildGPX(gpxData.toObject());
  };

  const generateMetadata = (data): MetaData => {
    const points = data.trk[0].trkseg[0].trkpt;

    const len = points.length;

    const start = points[0];
    const end = points[len - 1];

    let maxSpeed = 0;
    let averageSpeed = 0;
    let averageSpeedWhenMoving = 0;
    let movingPoints = 0;
    let maxCurrent = 0;

    points.map((point) => {
      const extension = point?.extensions[0]?.["esk8pal:TrackPointExtension"]?.[0];

      const current = parseFloat(extension?.["esk8pal:current"]?.[0]);

      if (current > maxCurrent) {
        maxCurrent = current;
      }

      const speed = parseFloat(extension?.["esk8pal:speed"]?.[0]);
      if (speed > maxSpeed) {
        maxSpeed = speed;
      }

      if (speed > 1) {
        averageSpeedWhenMoving += speed;
        movingPoints++;
      }

      averageSpeed += speed;
    });

    averageSpeed = averageSpeed / points.length;
    averageSpeedWhenMoving = averageSpeedWhenMoving / movingPoints;

    const tripTime = new Date(end.time).getTime() - new Date(start.time[0]).getTime();

    const extension = end?.extensions[0]?.["esk8pal:TrackPointExtension"]?.[0];
    const tripDistance = extension?.["esk8pal:trip_distance"]?.[0];
    const tripUsedEnergy = extension?.["esk8pal:used_energy"]?.[0];

    return {
      start: start.time[0],
      tripTime,
      tripDistance,
      tripUsedEnergy,
      maxSpeed,
      maxCurrent,
      averageSpeed,
      averageSpeedWhenMoving,
    };
  };

  const uploadDataToGridFs = (data: string, rideId: ObjectId): Promise<ObjectId> => {
    return new Promise((resolve, reject) => {
      const writestream: GridFSBucketWriteStream = gridfsBucket.openUploadStream(`log_${rideId}.gpx`);

      writestream.on("finish", () => {
        resolve(writestream.id as ObjectId);
      });
      writestream.on("error", () => {
        reject();
      });
      writestream.write(data);
      writestream.end();
    });
  };

  const createRideLog = async (req: express.Request, res: express.Response, data: string, deviceId: string) => {
    const rideId = new mongo.ObjectID();

    const metaData = generateMetadata(await parseGpx(data));

    const fileId = await uploadDataToGridFs(data, rideId);

    const ride: Ride = {
      _id: rideId,
      ownerId: req.user.sub,
      fileName: req.files.logfile.name,
      fileId: fileId,
      metaData,
      uploaded: new Date(),
      deviceId,
    };

    const response = await rides.insertOne(ride);
    if (response.result.ok === 1) {
      res.json(response.ops[0]);
      return;
    }

    //TODO remove file if inserting failed

    res.statusCode = 500;
    res.json(null);
  };

  passport.use(
    new BearerStrategy(async (token: string, done: Function) => {
      try {
        const ticket = await oAuth2Client.verifyIdToken({
          idToken: token,
          audience: process.env.CLIENT_ID,
        });
        const payload = ticket.getPayload();

        await users.updateOne({ sub: payload.sub }, { $set: payload }, { upsert: true });

        return done(null, payload, { scope: "all" });
      } catch (err) {
        return done(null, null, { scope: "all" });
      }
    })
  );

  app.get("/devices", passport.authenticate("bearer", { session: false }), async (req: express.Request, res: express.Response) => {
    const user = await users.findOne({ sub: req.user.sub });
    res.json(user.devices);
  });

  app.post("/devices", passport.authenticate("bearer", { session: false }), async (req: express.Request, res: express.Response) => {
    const device = { name: req.body.name, key: crypto.randomBytes(20).toString("hex"), _id: new mongo.ObjectID() };
    await users.updateOne({ sub: req.user.sub }, { $push: { devices: device } });

    const user = await users.findOne({ sub: req.user.sub });
    res.json(user.devices);
  });

  app.delete("/devices/:id", passport.authenticate("bearer", { session: false }), async (req: express.Request, res: express.Response) => {
    const deviceId = new mongo.ObjectID(req.params.id);
    await users.updateOne({ sub: req.user.sub }, { $pull: { devices: { _id: deviceId } } });

    const user = await users.findOne({ sub: req.user.sub });
    res.json(user.devices);
  });

  app.get("/rides", passport.authenticate("bearer", { session: false }), async (req: express.Request, res: express.Response) => {
    const allRides = await rides
      .find({ ownerId: req.user.sub })
      .project({
        _id: true,
        fileName: true,
        metaData: true,
      })
      .toArray();
    res.json(allRides);
  });

  app.get("/rides/:id", passport.authenticate("bearer", { session: false }), async (req: express.Request, res: express.Response) => {
    const rideId = req.params.id;
    const ride = (await rides.findOne({ ownerId: req.user.sub, _id: new mongo.ObjectID(rideId) })) as Ride;
    if (ride) {
      res.json(ride);
    } else {
      res.sendStatus(404);
    }
  });

  app.get("/rides/:id/meta", passport.authenticate("bearer", { session: false }), async (req: express.Request, res: express.Response) => {
    const rideId = req.params.id;
    const ride = (await rides.findOne({ ownerId: req.user.sub, _id: new mongo.ObjectID(rideId) })) as Ride;
    if (ride) {
      const data = await streamToString(gridfsBucket.openDownloadStream(ride.fileId));
      const parsedData = await parseGpx(data);

      const metadata = generateMetadata(parsedData);

      res.statusCode = 200;
      res.send(metadata);
    } else {
      res.sendStatus(404);
    }
  });

  app.get("/rides/:id/data", passport.authenticate("bearer", { session: false }), async (req: express.Request, res: express.Response) => {
    const rideId = req.params.id;
    const ride = (await rides.findOne({ ownerId: req.user.sub, _id: new mongo.ObjectID(rideId) })) as Ride;
    if (ride) {
      gridfsBucket.openDownloadStream(ride.fileId).pipe(res);
    } else {
      res.sendStatus(404);
    }
  });

  app.post("/upload", async (req: express.Request, res: express.Response) => {
    const key = req.query.key;

    console.log("upload", req.query);

    if (key && req.files?.logfile) {
      const user = await users.findOne({ "devices.key": req.query.key });

      const device = user.devices.find((device) => device.key === req.query.key);

      req.user = user;

      try {
        const gpx = generateGpx(req.files.logfile.data);
        await createRideLog(req, res, gpx, device._id);
      } catch {
        res.sendStatus(500);
      }
    } else {
      res.sendStatus(400);
    }
  });

  app.post("/:deviceId/csv", passport.authenticate("bearer", { session: false }), async (req: express.Request, res: express.Response) => {
    const gpx = generateGpx(req.files.logfile.data);
    await createRideLog(req, res, gpx, req.params.deviceId);
  });

  app.post("/:deviceId/gpx", passport.authenticate("bearer", { session: false }), async (req: express.Request, res: express.Response) => {
    await createRideLog(req, res, req.files.logfile.data, req.params.deviceId);
  });

  app.post("/convert", async (req: express.Request, res: express.Response) => {
    const gpx = generateGpx(req.files.file.data);

    res.statusCode = 200;
    res.send(gpx);
  });

  console.log("started");
  app.listen(8080);
})();
