const xml2js = require("xml2js");

export function parseGpx(xml: string) {
  return new Promise((resolve, reject) => {
    let parser = new xml2js.Parser();
    parser.parseString(xml, (err: any, xml: any) => {
      if (err) {
        reject(err);
      } else {
        resolve(xml.gpx);
      }
    });
  });
}
