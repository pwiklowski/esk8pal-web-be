import { ObjectID } from "mongodb";

export default interface Ride {
  fileId: string;
  filename: string;
  _id: ObjectID;
}
