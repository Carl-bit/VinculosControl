-- Acceso de los demos (2026-11-19): cuentas ficticias y contrasena cifrada para compartir el demo. Aditiva.
CREATE TABLE "accesos_demo" (
    "centro_id" INTEGER NOT NULL,
    "clave_cifrada" TEXT NOT NULL,
    "cuentas" JSONB NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accesos_demo_pkey" PRIMARY KEY ("centro_id")
);

ALTER TABLE "accesos_demo" ADD CONSTRAINT "accesos_demo_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;
