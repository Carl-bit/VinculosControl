/**
 * Limite por IP del formulario publico (5 por hora). En memoria: con una sola
 * instancia de la API basta (todo.txt: si hay replicas, pasar el contador a la BD).
 */
export class LimitePorIp {
  private readonly marcas = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly ventanaMs: number,
  ) {}

  /** true si la IP todavia puede enviar (y registra el envio). */
  permitir(ip: string, ahora = Date.now()): boolean {
    const desde = ahora - this.ventanaMs;
    const previas = (this.marcas.get(ip) ?? []).filter((t) => t > desde);
    if (previas.length >= this.max) {
      this.marcas.set(ip, previas);
      return false;
    }
    previas.push(ahora);
    this.marcas.set(ip, previas);
    if (this.marcas.size > 10_000) this.limpiar(ahora);
    return true;
  }

  private limpiar(ahora: number) {
    const desde = ahora - this.ventanaMs;
    for (const [ip, ts] of this.marcas) if (!ts.some((t) => t > desde)) this.marcas.delete(ip);
  }
}
