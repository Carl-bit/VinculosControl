-- R13: estado de las exportaciones del centro (lo informa el agente). Aditiva.
ALTER TABLE "silos" ADD COLUMN "exportes_visto_en" TIMESTAMP(3);

CREATE TABLE "exportaciones_silo" (
    "silo_slug" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "creada_en" TIMESTAMP(3) NOT NULL,
    "terminada_en" TIMESTAMP(3),
    "vence_en" TIMESTAMP(3),
    "bytes" BIGINT,
    "huella" TEXT,
    "vista_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exportaciones_silo_pkey" PRIMARY KEY ("silo_slug","id")
);
