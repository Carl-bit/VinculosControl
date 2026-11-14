-- CreateTable
CREATE TABLE "salidas" (
    "id" SERIAL NOT NULL,
    "centro_id" INTEGER NOT NULL,
    "silo_slug" TEXT NOT NULL,
    "fecha_corte" DATE NOT NULL,
    "motivo" TEXT NOT NULL,
    "desde" "estado_centro" NOT NULL,
    "iniciada_por" TEXT NOT NULL,
    "iniciada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exporte_en" TIMESTAMP(3),
    "exporte_bytes" BIGINT,
    "exporte_huella" TEXT,
    "acta_recepcion_firmada_en" TIMESTAMP(3),
    "recibe_nombre" TEXT,
    "recibe_cargo" TEXT,
    "conteo_pacientes" INTEGER,
    "conteo_fichas" INTEGER,
    "acta_recepcion_hash" TEXT,
    "acta_recepcion_por" TEXT,
    "gracia_dias" INTEGER NOT NULL DEFAULT 30,
    "gracia_hasta" TIMESTAMP(3),
    "silo_detenido_en" TIMESTAMP(3),
    "silo_detenido_por" TEXT,
    "confirmacion_en" TIMESTAMP(3),
    "confirmacion_medio" TEXT,
    "confirmacion_ref" TEXT,
    "confirmacion_por" TEXT,
    "acta_eliminacion" JSONB,
    "acta_eliminacion_hash" TEXT,
    "eliminado_en" TIMESTAMP(3),
    "eliminado_por" TEXT,

    CONSTRAINT "salidas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "salidas_centro_id_key" ON "salidas"("centro_id");

-- CreateIndex
CREATE INDEX "salidas_silo_slug_idx" ON "salidas"("silo_slug");

-- AddForeignKey
ALTER TABLE "salidas" ADD CONSTRAINT "salidas_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

