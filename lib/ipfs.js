import axios from 'axios';
import FormData from 'form-data';

export async function uploadImageToIPFS(imageUrl, filename = 'pixel.png') {
  const jwt = process.env.PINATA_JWT;

  if (!jwt) {
    throw new Error('Missing PINATA_JWT');
  }

  const imageResponse = await axios.get(imageUrl, {
    responseType: 'arraybuffer'
  });

  const formData = new FormData();

  formData.append('file', Buffer.from(imageResponse.data), {
    filename,
    contentType: 'image/png'
  });

  const response = await axios.post(
    'https://api.pinata.cloud/pinning/pinFileToIPFS',
    formData,
    {
      maxBodyLength: Infinity,
      headers: {
        Authorization: `Bearer ${jwt}`,
        ...formData.getHeaders()
      }
    }
  );

  const cid = response.data?.IpfsHash;

  if (!cid) {
    throw new Error(`Pinata image upload failed: ${JSON.stringify(response.data)}`);
  }

  return {
    cid,
    ipfsUrl: `ipfs://${cid}`,
    gatewayUrl: `https://gateway.pinata.cloud/ipfs/${cid}`
  };
}

export async function uploadMetadataToIPFS(metadata) {
  const jwt = process.env.PINATA_JWT;

  if (!jwt) {
    throw new Error('Missing PINATA_JWT');
  }

  const response = await axios.post(
    'https://api.pinata.cloud/pinning/pinJSONToIPFS',
    metadata,
    {
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json'
      }
    }
  );

  const cid = response.data?.IpfsHash;

  if (!cid) {
    throw new Error(`Pinata metadata upload failed: ${JSON.stringify(response.data)}`);
  }

  return {
    cid,
    ipfsUrl: `ipfs://${cid}`,
    gatewayUrl: `https://gateway.pinata.cloud/ipfs/${cid}`
  };
}
