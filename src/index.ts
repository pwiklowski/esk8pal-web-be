import express = require("express");
import dotenv from "dotenv";
import * as mongo from "mongodb";
import Ride from "./ride";
import { GridFSBucket, GridFSBucketWriteStream } from "mongodb";
import { parseGpx } from "./gpxParser";

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
        ele: rec.altitude,
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

  const uploadDataToGridFs = (data: string, rideId: string) => {
    return new Promise((resolve, reject) => {
      const writestream: GridFSBucketWriteStream = gridfsBucket.openUploadStream(`log_${rideId}.gpx`);

      writestream.on("finish", () => {
        resolve(writestream.id);
      });
      writestream.on("error", () => {
        reject();
      });
      writestream.write(data);
      writestream.end();
    });
  };

  const createRideLog = async (req: express.Request, res: express.Response, data: string) => {
    const rideId = new mongo.ObjectID();

    const fileId = await uploadDataToGridFs(data, rideId);

    const ride: Ride = {
      _id: rideId,
      name: req.files.logfile.name,
      fileId: fileId,
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

        users.updateOne({ sub: payload.sub }, { $set: payload }, { upsert: true });

        return done(null, payload, { scope: "all" });
      } catch (err) {
        return done(null, null, { scope: "all" });
      }
    })
  );

  app.get("/rides", passport.authenticate("bearer", { session: false }), async (req: express.Request, res: express.Response) => {
    const allRides = await rides
      .find({})
      .project({
        _id: true,
        name: true,
      })
      .toArray();
    res.json(allRides);
  });

  app.get("/rides/:id", passport.authenticate("bearer", { session: false }), async (req: express.Request, res: express.Response) => {
    const rideId = req.params.id;
    const ride = (await rides.findOne({ _id: new mongo.ObjectID(rideId) })) as Ride;
    if (ride) {
      res.json(ride);
    } else {
      res.sendStatus(404);
    }
  });

  app.get("/rides/:id/meta", passport.authenticate("bearer", { session: false }), async (req: express.Request, res: express.Response) => {
    const rideId = req.params.id;
    const ride = (await rides.findOne({ _id: new mongo.ObjectID(rideId) })) as Ride;
    if (ride) {
      const data = await streamToString(gridfsBucket.openDownloadStream(ride.fileId));
      const parsedData = await parseGpx(data);
      res.send(parsedData);
    } else {
      res.sendStatus(404);
    }
  });

  app.get("/rides/:id/data", passport.authenticate("bearer", { session: false }), async (req: express.Request, res: express.Response) => {
    const rideId = req.params.id;
    const ride = (await rides.findOne({ _id: new mongo.ObjectID(rideId) })) as Ride;
    if (ride) {
      gridfsBucket.openDownloadStream(ride.fileId).pipe(res);
    } else {
      res.sendStatus(404);
    }
  });

  app.post("/csv", passport.authenticate("bearer", { session: false }), async (req: express.Request, res: express.Response) => {
    const gpx = generateGpx((req as any).files.logfile.data);
    await createRideLog(req, res, gpx);
  });

  app.post("/gpx", passport.authenticate("bearer", { session: false }), async (req: express.Request, res: express.Response) => {
    await createRideLog(req, res, req.files.logfile.data);
  });

  app.post("/convert", async (req: express.Request, res: express.Response) => {
    const gpx = generateGpx((req as any).files.file.data);

    res.statusCode = 200;
    res.send(gpx);
  });

  console.log("started");
  app.listen(8080);
})();
