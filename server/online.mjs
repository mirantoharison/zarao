// Lance le serveur en ligne (ZARAO_ROLE=online) : `npm run server:online`. Fichier séparé pour rester portable (pas de cross-env).
process.env.ZARAO_ROLE = "online";
await import("./index.mjs");
