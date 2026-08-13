import { supabase } from '@/lib/supabase'

/**
 * Cerrar una sugerencia a mano.
 *
 * El cierre automático ya existe —`closeFulfilled` cruza tus operaciones de
 * IOL contra las sugerencias abiertas—, pero solo cubre el caso feliz: operar
 * el símbolo sugerido por al menos el 80% del monto, dentro de IOL. No cubre
 * una compra parcial, una decisión de no hacerlo, ni un "no hacer nada", que
 * no tiene operación posible.
 *
 * `fulfilled` y `dismissed` se guardan en columnas distintas a propósito: la
 * tasa de aciertos del asesor se mide sobre lo que efectivamente seguiste, así
 * que contar un descarte como ejecutado la inflaría.
 */
export async function resolveRecommendation(
  id: string,
  how: 'fulfilled' | 'dismissed',
): Promise<void> {
  const patch =
    how === 'fulfilled'
      ? { fulfilled_at: new Date().toISOString(), is_active: false }
      : { dismissed_at: new Date().toISOString(), is_active: false }

  const { error } = await supabase.from('recommendations').update(patch).eq('id', id)

  // Sin la 0029 no existe `dismissed_at`. Se desactiva igual: que la tarjeta no
  // desaparezca es peor que perder el matiz de por qué se cerró.
  if (error && how === 'dismissed') {
    const { error: legacy } = await supabase
      .from('recommendations')
      .update({ is_active: false })
      .eq('id', id)
    if (legacy) throw legacy
    return
  }

  if (error) throw error
}
