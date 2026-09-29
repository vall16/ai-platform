# Report per un profano — AI Platform

1. Stiamo costruendo una **piattaforma SaaS** che vende "doppi digitali" di persone e aziende: un'AI che parla, risponde e si comporta come te, da incorporare nel proprio sito web.
2. Il primo prodotto è l'**AI Persona**: un assistente conversazionale con voce, personalità configurabile e conoscenza del contenuto del sito (es. "raccontami del vostro studio"). Si installa su WordPress.
3. Il secondo prodotto è il **venditore AI** per negozi online: conosce il catalogo, gestisce il carrello e aiuta a chiudere la vendita. Si installa su Shopify e WooCommerce. **Anche questo è ora costruito e funzionante.**
4. Il cuore del progetto è un **motore intelligente** che sceglie automaticamente, per ogni conversazione, il fornitore di AI/voce migliore in rapporto qualità-prezzo-velocità, e **misura al centesimo** quanto costa ogni conversazione rispetto a quanto si incassa.
5. È tutto **multi-tenant**: ogni cliente ha i propri dati, la propria chiave e il proprio margine, isolati dagli altri.
6. Ci sono **due sale di controllo**: una per gli operatori (sessioni attive, costi, margini e stato di salute dei fornitori in tempo reale) e una **dashboard per ogni cliente** con i propri numeri (sessioni, costi, ricavi, margine).
7. **A che punto siamo:** i **due prodotti funzionano end-to-end** e l'intero sistema di costi e ricavi è completo. Il tutto è verificato da una suite di test formale che è tutta verde.
8. Il sistema funziona oggi con **fornitori simulati** (mock): l'architettura è pronta per collegare i servizi reali (OpenAI, Deepgram, ecc.) senza toccare il resto del codice.
9. Rispetto all'ultima versione di questo report è stato aggiunto: la **scelta del fornitore in base al piano e al budget** del cliente, la possibilità di **usare GPU in proprio** per abbassare i costi quando c'è molto traffico, la **conformità GDPR** (export e cancellazione dati su richiesta), il **deploy automatico** su Kubernetes e il **monitoring** completo.
10. In sintesi: **la base è solida e provata, entrambi i prodotti funzionano end-to-end; ora si passa ai fornitori reali e alle funzioni avanzate (rilevamento anomalie, simulazioni, routing per regione).**
