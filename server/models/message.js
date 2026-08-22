import { db } from "../database.js";

class Message {
  id;
  session_id;
  data;
  created_at;
  created_by;
  client_id;

  constructor(data) {
    Object.assign(this, data);
  }

  save() {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT OR IGNORE into messages (session_id, data, created_at, client_id)
                 values (?, ?, ?, ?);`,
        [
          this.session_id,
          JSON.stringify(this.data),
          this.created_at,
          this.client_id || null,
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes ? this.lastID : null);
          }
        }
      );
    });
  }
}

export default Message;
