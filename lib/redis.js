export async function redisCommand(commandArray) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commandArray),
    });
    const data = await res.json();
    return data.result;
  } catch (err) {
    console.error('Redis error:', err);
    return null;
  }
}