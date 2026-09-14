import whatsappWebJs from "whatsapp-web.js";
import type { WhatsAppWebJsClientFactory, WebJsClient } from "./types.js";

const { Client, LocalAuth } = whatsappWebJs;

export const defaultWhatsAppWebJsClientFactory: WhatsAppWebJsClientFactory = (context) =>
  new Client({
    authStrategy: new LocalAuth({
      clientId: context.connectionId,
      dataPath: context.authDirectory,
    }),
    puppeteer: {
      headless: context.headless,
      ...(context.executablePath === undefined ? {} : { executablePath: context.executablePath }),
      args: ["--disable-dev-shm-usage", "--no-sandbox"],
    },
  }) as unknown as WebJsClient;
