-- CreateEnum
CREATE TYPE "estado_centro" AS ENUM ('SOLICITUD', 'CONTACTADO', 'REUNION', 'DATOS_COMPLETOS', 'APROBADO', 'APROVISIONANDO', 'ACTIVO', 'ACTIVO_SIN_DOMINIO', 'SUSPENDIDO', 'EN_SALIDA', 'EXPORTADO', 'GRACIA', 'ELIMINADO', 'DESCARTADO');

-- CreateTable
CREATE TABLE "centros" (
    "id" SERIAL NOT NULL,
    "slug" TEXT,
    "nombre" TEXT NOT NULL,
    "estado" "estado_centro" NOT NULL DEFAULT 'SOLICITUD',
    "contacto_nombre" TEXT NOT NULL,
    "contacto_correo" TEXT NOT NULL,
    "contacto_telefono" TEXT,
    "comuna" TEXT NOT NULL,
    "origen" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "centros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transiciones_centro" (
    "id" SERIAL NOT NULL,
    "centro_id" INTEGER NOT NULL,
    "desde" "estado_centro",
    "hacia" "estado_centro" NOT NULL,
    "actor" TEXT NOT NULL,
    "motivo" TEXT,
    "en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transiciones_centro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revisiones_manifiesto" (
    "id" SERIAL NOT NULL,
    "centro_id" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "fase" INTEGER NOT NULL,
    "contenido" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "autor" TEXT NOT NULL,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revisiones_manifiesto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "centros_slug_key" ON "centros"("slug");

-- CreateIndex
CREATE INDEX "centros_estado_creado_en_idx" ON "centros"("estado", "creado_en");

-- CreateIndex
CREATE INDEX "transiciones_centro_centro_id_en_idx" ON "transiciones_centro"("centro_id", "en");

-- CreateIndex
CREATE UNIQUE INDEX "revisiones_manifiesto_centro_id_numero_key" ON "revisiones_manifiesto"("centro_id", "numero");

-- AddForeignKey
ALTER TABLE "transiciones_centro" ADD CONSTRAINT "transiciones_centro_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisiones_manifiesto" ADD CONSTRAINT "revisiones_manifiesto_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;
