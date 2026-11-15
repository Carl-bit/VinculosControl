-- Aprovisionar (R1): espera del operador y version/digests del silo. Aditiva.
ALTER TYPE "estado_job" ADD VALUE 'ESPERANDO_OPERADOR';

ALTER TABLE "silos" ADD COLUMN "version" TEXT,
ADD COLUMN "api_digest" TEXT,
ADD COLUMN "web_digest" TEXT;
