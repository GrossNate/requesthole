<img
  src="./favicon.png" 
  alt="RequestHole logo"
  width="192" />

# RequestHole
A place to capture, store, and examine your HTTP requests.

## Installation instructions

This uses [Docker Compose](https://docs.docker.com/compose/), so you'll need
that installed. There are no secrets to configure — storage is a single
embedded SQLite file on a Docker volume.

1. `docker compose up --build --detach`
2. Open `http://localhost:8080` (override the published port with `WEB_PORT`).

Captured data lives in the `data` volume and survives `docker compose down`; run
`docker compose down -v` to discard it.

> A fuller install/deploy guide is coming in task 0003.

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
