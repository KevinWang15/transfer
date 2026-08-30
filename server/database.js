import sqlite3 from "sqlite3";

const db = new sqlite3.Database("./data/db.sqlite3");

function run(query) {
  return new Promise((resolve, reject) => {
    db.run(query, (error) => (error ? reject(error) : resolve()));
  });
}

async function createTables() {
  await run(`
    create table if not exists messages
    (
      id integer primary key autoincrement,
      session_id text,
      data text,
      created_at datetime,
      client_id text
    );
  `);

  await run(`
    create index if not exists session_id_index
      on messages (session_id);
  `);
  await run(`
    create unique index if not exists message_client_id_index
      on messages (session_id, client_id)
      where client_id is not null;
  `);
}

await createTables();

export { db };
