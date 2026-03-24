import { getCloudstickServersTool } from './src/tools/get_cloudstick_servers.js';

async function test() {
    const res = await getCloudstickServersTool.execute({});
    console.log(res.output);
}
test();
