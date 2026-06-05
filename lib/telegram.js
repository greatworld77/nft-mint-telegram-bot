import axios from 'axios';

export async function getTelegramFileBuffer(fileId) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  const fileResp = await axios.get(
    `https://api.telegram.org/bot${token}/getFile`,
    {
      params: {
        file_id: fileId
      }
    }
  );

  const filePath = fileResp.data?.result?.file_path;

  if (!filePath) {
    throw new Error('Could not get Telegram file path');
  }

  const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

  const imageResp = await axios.get(fileUrl, {
    responseType: 'arraybuffer'
  });

  return Buffer.from(imageResp.data);
}
