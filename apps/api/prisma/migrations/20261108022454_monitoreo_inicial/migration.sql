-- CreateTable
CREATE TABLE "silos" (
    "slug" TEXT NOT NULL,
    "dominio" TEXT,
    "adoptado" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visto_en" TIMESTAMP(3),
    "adoptado_en" TIMESTAMP(3),

    CONSTRAINT "silos_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "agentes" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "version" TEXT,
    "ultimo_latido" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agentes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "muestras_salud" (
    "id" BIGSERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "http" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "bd" BOOLEAN,
    "canarios" BOOLEAN,
    "latencia_ms" INTEGER,
    "error" TEXT,

    CONSTRAINT "muestras_salud_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metricas_contenedor" (
    "id" BIGSERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "servicio" TEXT NOT NULL,
    "en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cpu_pct" DOUBLE PRECISION NOT NULL,
    "mem_bytes" BIGINT NOT NULL,
    "mem_limite" BIGINT NOT NULL,
    "reinicios" INTEGER NOT NULL,
    "oom" BOOLEAN NOT NULL,
    "estado" TEXT NOT NULL,

    CONSTRAINT "metricas_contenedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metricas_host" (
    "id" BIGSERIAL NOT NULL,
    "en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disco_pct" DOUBLE PRECISION NOT NULL,
    "mem_usada" BIGINT NOT NULL,
    "mem_total" BIGINT NOT NULL,
    "carga1" DOUBLE PRECISION NOT NULL,
    "cpus" INTEGER NOT NULL,

    CONSTRAINT "metricas_host_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "latencias_ruta" (
    "id" BIGSERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ruta" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "p50" INTEGER NOT NULL,
    "p95" INTEGER NOT NULL,
    "max" INTEGER NOT NULL,

    CONSTRAINT "latencias_ruta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "respaldos" (
    "slug" TEXT NOT NULL,
    "archivo" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "bytes" BIGINT NOT NULL,
    "sha256" TEXT,
    "visto_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "respaldos_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "alertas" (
    "id" SERIAL NOT NULL,
    "clave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "severidad" TEXT NOT NULL,
    "slug" TEXT,
    "mensaje" TEXT NOT NULL,
    "abierta_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerrada_en" TIMESTAMP(3),

    CONSTRAINT "alertas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agentes_nombre_key" ON "agentes"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "agentes_token_hash_key" ON "agentes"("token_hash");

-- CreateIndex
CREATE INDEX "muestras_salud_slug_en_idx" ON "muestras_salud"("slug", "en");

-- CreateIndex
CREATE INDEX "metricas_contenedor_slug_en_idx" ON "metricas_contenedor"("slug", "en");

-- CreateIndex
CREATE INDEX "metricas_host_en_idx" ON "metricas_host"("en");

-- CreateIndex
CREATE INDEX "latencias_ruta_slug_en_idx" ON "latencias_ruta"("slug", "en");

-- CreateIndex
CREATE INDEX "alertas_clave_cerrada_en_idx" ON "alertas"("clave", "cerrada_en");
