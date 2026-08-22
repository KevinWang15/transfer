# transfer

![DEMO](./demo.gif)

```
docker run --restart unless-stopped -v ./data:/app/data -p 6611:6611 kevinwang15/transfer
```

"Web 版免登入文件传输助手"（类似微信文件传输助手）

Simple web app for file / message transfer: Transfer files / messages between devices. (You can self-host it easily with docker)

1. Run the service using docker with one command line.
2. Go to the WebUI, create a "transfer" session with just one click.
3. Copy the session link to your second device to join (or share the session link with other people).
4. All other devices will be able to see any messages or files you send in this session.

Only the most recent 100 messages within a 3-day window are preserved.

## Large file uploads

Browser uploads are split into independently authenticated AES-GCM chunks. A
bounded number of chunks are encrypted and uploaded in parallel, and the server
stores completed chunks under `data/upload-chunks/` until it can stream them into
the final file. If an upload is interrupted, selecting the same file again in
the same browser/session resumes the chunks already accepted by the server.

Incomplete uploads and completed resume markers are removed automatically after
three days by default. The `data` directory must be on persistent storage and
must have room for both the temporary chunks and the final file while a merge is
in progress.

The upload behavior can be tuned with environment variables:

| Variable                          |    Default | Purpose                                             |
| --------------------------------- | ---------: | --------------------------------------------------- |
| `UPLOAD_CHUNK_SIZE_BYTES`         |  `4194304` | Plaintext bytes per browser chunk                   |
| `UPLOAD_MAX_CHUNK_SIZE_BYTES`     | `16777216` | Largest chunk accepted by the server                |
| `UPLOAD_CONCURRENCY`              |        `3` | Parallel chunk requests per browser upload          |
| `UPLOAD_DECRYPTION_CONCURRENCY`   |        `2` | Chunks decrypted concurrently by one server process |
| `UPLOAD_STALE_TTL_SECONDS`        |   `259200` | Age at which abandoned upload data is deleted       |
| `UPLOAD_CLEANUP_INTERVAL_SECONDS` |     `3600` | Stale-upload sweep interval                         |
| `MESSAGE_PRUNE_INTERVAL_SECONDS`  |       `60` | Completed-message retention sweep interval          |

## Dev docs

### set up

```
cd api
sudo npm link
cd ..
npm link "@transfer/api"
```

### developing

```
npm run dev
```

Visit http://localhost:3000/ (both frontend and backend will reload on code change).

### production build

```
npm run build
```
