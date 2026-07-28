# Japan Loop — notas para Claude Code

Las instrucciones del proyecto viven en **[AGENTS.md](AGENTS.md)**, que es el
fichero que leen todos los agentes (Codex incluido, que no mira este). Una sola
copia, para que no se separen con el tiempo:

@AGENTS.md

Si por lo que sea la línea de arriba no se importa, la regla que NO se puede
olvidar es esta:

> Todos los proyectos de Rubén se publican bajo el mismo origen
> `ruben-arconada.github.io`, y `CacheStorage` / `localStorage` están aislados
> **por origen, no por carpeta**. El nombre de caché lleva prefijo de proyecto y
> el borrado de `activate()` SOLO puede tocar claves con ese prefijo — un
> `keys.filter(k => k !== CACHE)` borra las cachés de los juegos vecinos. Pasó
> de verdad en `tokyo-loop`, `abismo` y `abismo-2`; el detalle está en AGENTS.md.
