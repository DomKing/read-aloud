import { z, OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { Service, FORMAT_CONTENT_TYPE } from "../utils/synthesis";
import retry, { RetryError } from "../utils/retry";
type Bindings = {
  TOKEN: string;
};
const synthesis = new OpenAPIHono<{ Bindings: Bindings }>();
export default synthesis;

const querySchema = z.object({
  voiceName: z
    .string()
    .optional()
    .openapi({
      param: { description: "语音名称" },
      example: "zh-CN-XiaoxiaoNeural",
    }),
  pitch: z
    .string()
    .optional()
    .openapi({
      param: { description: "音高" },
      examples: ["-50%", "-50Hz", "low"],
    }),
  rate: z
    .string()
    .optional()
    .openapi({ param: { description: "语速" } }),
  volume: z
    .string()
    .optional()
    .openapi({ param: { description: "音量" } }),
  format: z
    .string()
    .optional()
    .openapi({ param: { description: "音频格式" } }),
  token: z
    .string()
    .optional()
    .openapi({ param: { description: "Token" } }),
  text: z.string().openapi({ param: { description: "合成文本" } }),
});

const route = createRoute({
  method: "get",
  path: "/",
  request: { query: querySchema },
  responses: {
    200: { description: "返回音频" },
    401: { description: "Unauthorized" },
    500: { description: "Error" },
  },
});

synthesis.openapi(route, async (c) => {
  const {
    voiceName = "zh-CN-XiaoxiaoNeural",
    rate,
    pitch,
    text = "",
    format = "audio-24khz-48kbitrate-mono-mp3",
    token,
  } = c.req.valid("query");

  if (c.env.TOKEN !== undefined && c.env.TOKEN !== "") {
    if (token !== c.env.TOKEN) {
      c.status(401);
      return c.text("Unauthorized");
    }
  }

  const service = new Service();

  if (!FORMAT_CONTENT_TYPE.has(format)) {
    throw new HTTPException(400, { message: `无效的音频格式：${format}` });
  }

  const ssml = `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xmlns:emo="http://www.w3.org/2009/10/emotionml" version="1.0" xml:lang="zh-CN"><voice name="${voiceName}"><prosody rate="${rate}%">${text}</prosody></voice></speak>`;
  try {
    const result = await retry(
      async () => {
        const result = await service.convert(ssml, format as string);
        return result;
      },
      3,
      (index, error, abort) => {
        console.warn(`Attempt ${index} failed：${error}`);
        if (
          error instanceof Error &&
          error.message.includes("SSML is invalid")
        ) {
          abort();
          throw new HTTPException(400, { message: "SSML 无效" });
        }
      },
    );
    c.header("Content-Type", FORMAT_CONTENT_TYPE.get(format));
    return c.body(result);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    c.status(500);
    if (!(error instanceof RetryError))
      throw new HTTPException(500, {
        message: `UnknownError: ${(error as string).toString()}`,
      });
    throw new HTTPException(500, {
      message: `${error.message}. Cause: ${error.cause.map((e) => (e as Error).toString()).join(", ")}`,
    });
  }
});
