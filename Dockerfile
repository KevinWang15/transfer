FROM node:22-alpine

RUN mkdir /app
WORKDIR /app
ADD ./package.json ./package-lock.json /app/
RUN apk add --no-cache libstdc++ \
    && apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm ci \
    && apk del .build-deps

ADD . /app

WORKDIR /app/api
RUN npm link

WORKDIR /app
RUN npm link @transfer/api

RUN npm run build

RUN mkdir /app/data

CMD ["npm", "run", "start-server"]
