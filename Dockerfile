FROM node:18-alpine

RUN mkdir /app
WORKDIR /app
ADD ./package.json /app
RUN npm install

ADD . /app

WORKDIR /app/api
RUN npm link

WORKDIR /app
RUN npm link @transfer/api

RUN npm run build

RUN mkdir /app/data

CMD ["npm", "run", "start-server"]
