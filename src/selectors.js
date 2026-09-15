'use strict';

/**
 * selectors.js
 * -----------------------------------------------------------------------
 * Ninguno de estos selectores es "definitivo" salvo que el comentario diga
 * explícitamente "validado con evidencia real".
 * -----------------------------------------------------------------------
 */

module.exports = {
  // --- Aviso de cookies / modales que pueden tapar la pantalla al entrar ---
  modalesGenericos: {
    botonesCierre: [
      // FIX 15/09/2026: Glifing empezó a mostrar un aviso de cookies nuevo
      // (Cookiebot, un widget de terceros muy usado) que antes no existía
      // y bloqueaba el click en "Entrar" ("subtree intercepts pointer
      // events"). Los IDs de Cookiebot son estándar de esa librería, no
      // específicos de Glifing, así que deberían ser estables.
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      '#CybotCookiebotDialogBodyButtonAccept',
      '#CybotCookiebotDialogBodyLevelButtonAccept',
      'button:has-text("Permitir todas")',
      'button:has-text("Permitir todo")',
      'button:has-text("Allow all")',
      // Avisos genéricos previos (no específicos de Cookiebot):
      'button:has-text("Visto")',
      'button:has-text("Aceptar")',
      'button:has-text("Aceptar todas")',
      'button:has-text("Entendido")',
      'button:has-text("Cerrar")',
      '[aria-label="close"]',
      '[aria-label="Close"]',
      '.modal button.close',
      '.cookie-banner button'
    ]
  },

  // --- Formulario de login ---
  login: {
    campoUsuario: [
      'input[type="email"]',
      'input[name="email"]',
      'input[name="username"]',
      'input[id*="user" i]',
      'input[placeholder*="correo" i]',
      'input[placeholder*="usuario" i]'
    ],
    campoPassword: [
      'input[type="password"]',
      'input[name="password"]',
      'input[id*="pass" i]'
    ],
    botonSubmit: [
      'input[type="submit"]',
      'button[type="submit"]',
      'text="Entrar"',
      'text="Iniciar sesión"',
      'text="Ingresar"',
      'text="Login"',
      'button:has-text("Entrar")',
      'a:has-text("Entrar")',
      'div:has-text("Entrar")',
      '[role="button"]:has-text("Entrar")',
      'button:has-text("Iniciar sesión")',
      'button:has-text("Ingresar")',
      'button:has-text("Login")'
    ],
    indicadorSesionActiva: [
      'text=/cerrar sesión/i',
      'text=/mi cuenta/i',
      '[data-testid="user-menu"]'
    ]
  },

  // --- Selección de colegio ---
  // Validado con evidencia real: cambio de CUENTA/ROL desde el menú de
  // perfil (".user-menu"), NO un filtro en la página.
  colegio: {
    togglePerfil: [
      '.user-menu',
      'text=/gestor centro educativo/i',
      '[class*="user-menu" i]',
      '[class*="profile" i]',
      'header [class*="dropdown" i]'
    ],
    contenedorDesplegado: [
      '.dropdown-user-menu',
      '.user-menu .dropdown',
      '[class*="dropdown-user-menu" i]'
    ],
    opcion: (nombreColegio) => [
      `text=/gestor centro educativo\\s*\\([^)]*${nombreColegio}\\)/i`,
      `li:has-text("${nombreColegio}")`,
      `[role="option"]:has-text("${nombreColegio}")`
    ]
  },

  // --- Selección de curso / grupo ---
  // Validado con evidencia real: <select id="course">/<select id="group">
  // dentro de "#filterForm .curso-grupo", envueltos por Select2 (por eso
  // selectOption necesita force:true). Al cambiar, dispara
  // $('#filterForm').submit() -> recarga completa de página.
  cursoGrupo: {
    contenedorCurso: [
      '#filterForm .curso-grupo #course',
      'select#course',
      'select[name*="course" i]',
      'select[name*="curso" i]',
      '[data-testid="course-selector"]',
      '.course-selector'
    ],
    contenedorGrupo: [
      '#filterForm .curso-grupo #group',
      'select#group',
      'select[name*="group" i]',
      'select[name*="grupo" i]',
      '[data-testid="group-selector"]',
      '.group-selector'
    ]
  }
};