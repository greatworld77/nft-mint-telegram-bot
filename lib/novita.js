import axios from 'axios';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createPixelArtWithNovita(originalImageUrl) {
  const apiKey = process.env.NOVITA_API_KEY;
  const base = process.env.NOVITA_API_BASE || 'https://api.novita.ai';

  if (!apiKey) {
    throw new Error('Missing NOVITA_API_KEY');
  }

  const endpoint =
    process.env.NOVITA_IMG2IMG_ENDPOINT || `${base}/v3/async/img2img`;

  const payload = {
    image_file: originalImageUrl,
    prompt:
      'pixel art, 8-bit pixelated NFT avatar, clean edges, vibrant colors, high quality',
    negative_prompt: 'blurry, low quality, distorted, watermark, text',
    width: 512,
    height: 512,
    steps: 25,
    guidance_scale: 7.5,
    strength: 0.65
  };

  const start = await axios.post(endpoint, payload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });

  const taskId = start.data?.task_id || start.data?.task?.task_id;

  if (!taskId) {
    throw new Error(`Novita did not return task_id`);
  }

  const resultEndpoint =
    process.env.NOVITA_TASK_ENDPOINT || `${base}/v3/async/task-result`;

  for (let i = 0; i < 30; i++) {
    await sleep(3000);

    const res = await axios.get(resultEndpoint, {
      params: {
        task_id: taskId
      },
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    const status = res.data?.task?.status || res.data?.status;

    const images =
      res.data?.images ||
      res.data?.task?.images ||
      res.data?.result?.images;

    const imageUrl =
      images?.[0]?.image_url ||
      images?.[0]?.url ||
      images?.[0];

    if (imageUrl) return imageUrl;

    if (status === 'FAILED' || status === 'failed') {
      throw new Error('Novita image generation failed.');
    }
  }

  throw new Error('Novita task timed out.');
}
