-- CreateTable
CREATE TABLE "incidentes" (
    "id" SERIAL NOT NULL,
    "severidad" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "silo_slug" TEXT,
    "centro_id" INTEGER,
    "alerta_id" INTEGER,
    "detectado_en" TIMESTAMP(3) NOT NULL,
    "contenido_en" TIMESTAMP(3),
    "aviso_centro_en" TIMESTAMP(3),
    "ultima_actualizacion_en" TIMESTAMP(3),
    "informe_final_en" TIMESTAMP(3),
    "cerrado_en" TIMESTAMP(3),
    "creado_por" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incidentes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_incidente" (
    "id" SERIAL NOT NULL,
    "incidente_id" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_incidente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitudes_soporte" (
    "id" SERIAL NOT NULL,
    "silo_slug" TEXT NOT NULL,
    "centro_id" INTEGER,
    "motivo" TEXT NOT NULL,
    "alcance" TEXT NOT NULL,
    "autorizada_en" TIMESTAMP(3) NOT NULL,
    "vence_en" TIMESTAMP(3) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'ABIERTA',
    "resultado" TEXT,
    "creado_por" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerrada_en" TIMESTAMP(3),

    CONSTRAINT "solicitudes_soporte_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incidentes_cerrado_en_detectado_en_idx" ON "incidentes"("cerrado_en", "detectado_en");

-- CreateIndex
CREATE INDEX "eventos_incidente_incidente_id_en_idx" ON "eventos_incidente"("incidente_id", "en");

-- CreateIndex
CREATE INDEX "solicitudes_soporte_estado_vence_en_idx" ON "solicitudes_soporte"("estado", "vence_en");

-- AddForeignKey
ALTER TABLE "eventos_incidente" ADD CONSTRAINT "eventos_incidente_incidente_id_fkey" FOREIGN KEY ("incidente_id") REFERENCES "incidentes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
