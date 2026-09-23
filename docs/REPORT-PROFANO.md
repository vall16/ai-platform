# Report per un profano — AI Platform

1. Stiamo costruendo una **piattaforma SaaS** che vende "doppi digitali" di persone e aziende: un'AI che parla, risponde e si comporta come te, da incorporare nel proprio sito web.
2. Il primo prodotto è l'**AI Persona**: un assistente conversazionale con voce, personalità configurabile e conoscenza del contenuto del sito (es. "raccontami del vostro studio").
3. Il secondo prodotto (in arrivo) sarà un **venditore AI** per negozi online: conosce il catalogo, gestisce il carrello e aiuta a chiudere la vendita.
4. Il cuore del progetto è un **motore intelligente** che sceglie automaticamente, per ogni conversazione, il fornitore di AI/voce migliore in rapporto qualità-prezzo-velocità, e **misura al centesimo** quanto costa ogni conversazione rispetto a quanto si incassa.
5. È tutto **multi-tenant**: ogni cliente ha i propri dati, la propria chiave e il proprio margine, isolati dagli altri.
6. C'è anche una **sala di controllo** per gli operatori: sessioni attive, costi, margini e stato di salute dei fornitori in tempo reale.
7. **A che punto siamo:** la prima fase (MVP) è **completata** — il flusso completo funziona: il visitatore scrive o parla, l'AI risponde con voce, i costi e i ricavi vengono registrati, e il tutto è verificato da una suite di test formale che è tutta verde.
8. Il sistema funziona oggi con **fornitori simulati** (mock): l'architettura è pronta per collegare i servizi reali (OpenAI, Deepgram, ecc.) senza toccare il resto del codice.
9. **Prossima fase:** il venditore AI per e-commerce (Shopify/WooCommerce) e il sistema di costi completo.
10. In sintesi: **la base è solida e provata, il primo prodotto funziona end-to-end; ora si passa al secondo prodotto e alla scalabilità.**
