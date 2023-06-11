# transfer

![DEMO](./demo.gif)

```
docker run --restart unless-stopped -v ./data:/app/data -p 6611:6611 kevinwang15/transfer
```

"Web版免登入文件传输助手"（类似微信文件传输助手）

Simple web app for file / message transfer: Transfer files / messages between devices. (You can self-host it easily with docker)

1. Run the service using docker with one command line.
2. Go to the WebUI, create a "transfer" session with just one click.
3. Copy the session link to your second device to join (or share the session link with other people).
4. All other devices will be able to see any messages or files you send in this session.

Only the most recent 100 messages within a 3-day window are preserved.

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
