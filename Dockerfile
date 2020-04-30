FROM node:12.16

WORKDIR /usr/src/app

COPY dist/ /usr/src/app
COPY package.json /usr/src/app

RUN npm install

EXPOSE 8080
CMD [ "node", "index.js" ]
