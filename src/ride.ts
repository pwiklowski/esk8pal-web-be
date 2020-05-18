import { ObjectID } from "mongodb";

export default interface Ride {
  fileId: string;
  name: string;
  _id: ObjectID;
}
