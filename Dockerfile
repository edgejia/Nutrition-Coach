FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile

COPY . .
RUN yarn build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["sh", "-lc", "yarn db:migrate && yarn start"]
