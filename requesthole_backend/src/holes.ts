import { FastifyInstance, RouteShorthandOptions } from 'fastify';

function routes (fastify: FastifyInstance, options: RouteShorthandOptions) {
  fastify.get('/holes', options, (_req, _res) => {
    return { hello: 'world' };
  });

  // Add more routes here as needed
}

export default routes;