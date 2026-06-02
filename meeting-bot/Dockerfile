# Playwright's image ships Chromium + all its system libraries pre-installed,
# which the Teams adapter needs to join meetings as a headless browser guest.
# Keep this tag in lockstep with the "playwright" version in package.json — a
# mismatch makes Playwright re-download (or reject) the bundled browser.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
