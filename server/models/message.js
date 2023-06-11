import { db } from "../database.js";

class Message {
  id;
  session_id;
  data;
  created_at;
  created_by;

  constructor(data) {
    Object.assign(this, data);
  }

  save() {
    return new Promise((res) => {
      db.run(
        `INSERT into messages (session_id, data, created_at)
                 values (?, ?, ?);`,
        [this.session_id, JSON.stringify(this.data), this.created_at],
        function (err) {
          res(this.lastID);
        }
      );
    });
  }
}

export default Message;
