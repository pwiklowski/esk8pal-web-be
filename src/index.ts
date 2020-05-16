import express = require("express");
import dotenv from "dotenv";
import * as mongo from "mongodb";

const fileUpload = require("express-fileupload");

const passport = require("passport");
const BearerStrategy = require("passport-http-bearer");

dotenv.config();

const { OAuth2Client } = require("google-auth-library");
const oAuth2Client = new OAuth2Client(process.env.CLIENT_ID);

const { buildGPX, GarminBuilder } = require("gpx-builder");
const parse = require("csv-parse/lib/sync");
const { Point } = GarminBuilder.MODELS;
const gpxData = new GarminBuilder();

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
    const allRides = await rides.find({}).toArray();
    res.json(allRides);
  });

  app.post("/convert", async (req: express.Request, res: express.Response) => {
    const records = parse((req as any).files.file.data, {
      columns: true,
      from_line: 1,
    });

    const points = records.map((rec: any) => {
      return new Point(rec.latitude, rec.longitude, {
        time: new Date(parseInt(rec.timestamp) * 1000),
        speed: rec.speed,
      });
    });

    gpxData.setSegmentPoints(points);

    res.statusCode = 200;
    res.send(buildGPX(gpxData.toObject()));
  });

  console.log("started");
  app.listen(8080);
})();
