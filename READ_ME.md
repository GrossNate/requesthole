# RequestHole
A place to capture, store, and examine your HTTP requests.

## Installation instructions

This uses [Docker Compose](https://docs.docker.com/compose/) and
[dotenvx](https://dotenvx.com), so you'll need to install those on your own.

1. Either copy the `.env.keys` file from wherever you created it or replace the
   existing keys in `.env` with your own (in plaintext) and then run `dotenvx
   encrypt`.
2. Set up Nginx or whatever you're using.
3. `dotenvx run docker compose up -- --detach`