#!/bin/bash

# Define your signal handler
handle_sigterm() {
    echo "Forwarding SIGTERM to child processes..."
    kill -SIGTERM "$pid1" "$pid2"
}

# Register the signal handler
trap 'handle_sigterm' SIGTERM

nodemon --delay 1s server/index.js & pid1=$!
npm run start-frontend & pid2=$!

wait "$pid1"
wait "$pid2"
