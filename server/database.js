import sqlite3 from "sqlite3";

const db = new sqlite3.Database("./data/db.sqlite3");

function createTables() {
  return new Promise((resolve) => {
    const query = `
            create table if not exists messages
            (
                id
                integer
                primary
                key
                autoincrement,
                session_id
                text,
                data
                text,
                created_at
                datetime,
                created_by
                text
            );

            create index if not exists session_id_index
                on messages (session_id);
        `;

    db.run(query, () => {
      resolve();
    });
  });
}

await createTables();

export { db };
