<img
  src="./favicon.png" 
  alt="RequestHole logo"
  width="192" />

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

## Route design

| UI | route | purpose |
|:----|:-------|:---------|
GET | `/`     | main - view all holes
GET | `/view/:hole_address` | view list of requests in a hole
GET | `/view/:hole_address/:request_address` | view details of a request
&nbsp;||
**API** | | 
GET | `/api/` | list API reference?
GET | `/api/holes` | get all holes info
GET | `/api/hole/:hole_address` | get hole info
POST | `/api/hole` | create a new hole
DELETE | `/api/hole/:hole_address` | delete a hole
GET | `/api/hole/:hole_address/requests` | get all requests for a hole
GET | `/api/request/:request_address` | get specific request
DELETE | `/api/request/:request_address` | delete specific request
&nbsp; | | 
\* | `/:hole_address` | hole endpoint to ingest HTTP requests
