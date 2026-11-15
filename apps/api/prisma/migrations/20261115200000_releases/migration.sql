-- Releases y cascada (CONTEXTO.md seccion 7). Aditiva.
CREATE TABLE "releases" (
    "version" TEXT NOT NULL,
    "api_digest" TEXT NOT NULL,
    "web_digest" TEXT NOT NULL,
    "commit" TEXT NOT NULL,
    "publicada_en" TIMESTAMP(3) NOT NULL,
    "detectada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "en_demo_en" TIMESTAMP(3),
    "en_beta_en" TIMESTAMP(3),
    "en_estable_en" TIMESTAMP(3),
    "conflicto" TEXT,

    CONSTRAINT "releases_pkey" PRIMARY KEY ("version")
);

CREATE TABLE "cascadas" (
    "id" SERIAL NOT NULL,
    "version" TEXT NOT NULL,
    "canal" TEXT NOT NULL,
    "silos" TEXT[],
    "indice" INTEGER NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'EN_CURSO',
    "creada_por" TEXT NOT NULL,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminada_en" TIMESTAMP(3),
    "sin_exporte" BOOLEAN NOT NULL,

    CONSTRAINT "cascadas_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "jobs" ADD COLUMN "cascada_id" INTEGER;
