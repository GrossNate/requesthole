import Fastify from "fastify";
import fastifyPostgres from "@fastify/postgres";
import holesRoute from "./holes";
import dbInit from "./db-init";

const fastify = Fastify({
  logger: true,
});
fastify.register(fastifyPostgres, {connectionString: process.env.POSTGRES_URI});
fastify.register(dbInit);

fastify.get('/testpg', async (_, reply) => {
  const client = await fastify.pg.connect();
  try {
    const {rows} = await client.query('SELECT * FROM holes');
    reply.send(`row count: ${rows.length}`);
  } finally {
    client.release();
  }
});

fastify.register(holesRoute);

fastify.listen({ port: 3000 }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
