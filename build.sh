#!/bin/sh

npm run build-frontend
rm -rf ./server/frontend
cp -r build ./server/frontend
