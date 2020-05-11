import express = require("express");
const fileUpload = require("express-fileupload");

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
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  next();
});

(async () => {
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
