#!/usr/bin/env node

/**
 * vibe-check.js - Vérification pré-commit pour SwiperNews
 * 
 * Vérifie les règles critiques avant un commit :
 * - Cohérence des versions
 * - Présence des garde-fous
 * - Respect des conventions
 * - Problèmes de sécurité
 * 
 * @module vibe-check
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

/**
 * Vérificateur pré-commit SwiperNews
 */
class SwiperNewsChecker {
  constructor() {
    this.errors = []
    this.warnings = []
    this.checks = []
  }

  /**
   * Exécute toutes les vérifications
   */
  async check() {
    console.log('🔍 Vérification pré-commit SwiperNews...\n')
    
    await this.checkVersionConsistency()
    await this.checkCriticalFiles()
    await this.checkErrorHandling()
    await this.checkCapacitorHttp()
    await this.checkSecurity()
    await this.checkCodeStyle()
    await this.checkTests()
    
    this.displayResults()
    
    if (this.errors.length > 0) {
      console.error(`\n❌ ${this.errors.length} erreur(s) critique(s) trouvée(s). Commit bloqué.\n`)
      process.exit(1)
    } else if (this.warnings.length > 0) {
      console.warn(`\n⚠️  ${this.warnings.length} avertissement(s). Commit autorisé mais vérifiez.\n`)
      process.exit(0)
    } else {
      console.log('\n✅ Toutes les vérifications passées. Commit autorisé.\n')
      process.exit(0)
    }
  }

  /**
   * Vérifie la cohérence des versions
   */
  async checkVersionConsistency() {
    console.log('🔢 Vérification de la cohérence des versions...')
    
    let hasVersionChanges = false
    
    try {
      // Lire index.html
      const indexHtmlPath = join(REPO_ROOT, 'index.html')
      const indexContent = await readFile(indexHtmlPath, 'utf8')
      
      // Lire sw.js
      const swJsPath = join(REPO_ROOT, 'sw.js')
      const swContent = await readFile(swJsPath, 'utf8')
      
      // Extraire APP_VERSION
      const appVersionMatch = indexContent.match(/APP_VERSION:\s*["']([^"']+)["']/)
      const appVersion = appVersionMatch ? appVersionMatch[1] : null
      
      // Extraire version dans sw.js
      const cacheVersionMatch = swContent.match(/const CACHE = ["']flux-v(\d+)["']/)
      const cacheVersion = cacheVersionMatch ? cacheVersionMatch[1] : null
      
      // Extraire versions dans les scripts
      const scriptVersionMatches = [...indexContent.matchAll(/src\/([^.]+)\.js\?v=(\d+)/g)]
      const scriptVersions = scriptVersionMatches.map(m => m[2])
      const uniqueScriptVersions = [...new Set(scriptVersions)]
      
      // Vérifier la cohérence
      if (appVersion && cacheVersion) {
        const expectedVersion = cacheVersion
        const allVersionsMatch = uniqueScriptVersions.every(v => v === expectedVersion)
        
        if (!allVersionsMatch && scriptVersions.length > 0) {
          this.errors.push({
            code: 'VERSION_MISMATCH',
            message: 'Incohérence des versions entre index.html et sw.js',
            details: `APP_VERSION: ${appVersion}, CACHE: flux-v${cacheVersion}, Scripts: ${uniqueScriptVersions.join(', ')}`,
            fix: 'Mettre à jour tous les ?v= dans index.html avec la version de sw.js'
          })
        } else {
          this.checks.push({
            code: 'VERSION_OK',
            message: 'Versions cohérentes',
            status: '✅'
          })
        }
      } else {
        this.warnings.push({
          code: 'VERSION_NOT_FOUND',
          message: 'Impossible de trouver toutes les versions',
          details: `APP_VERSION: ${appVersion || 'non trouvé'}, CACHE: ${cacheVersion || 'non trouvé'}`,
          fix: 'Vérifier les patterns de version dans index.html et sw.js'
        })
      }
      
      // Vérifier si des fichiers src/*.js ont été modifiés
      const srcFiles = ['src/lib.js', 'src/i18n.js', 'src/learn-core.js']
      for (const srcFile of srcFiles) {
        try {
          const srcPath = join(REPO_ROOT, srcFile)
          await readFile(srcPath, 'utf8')
          hasVersionChanges = true
        } catch (error) {
          // Fichier non trouvé, ignorer
        }
      }
      
      if (hasVersionChanges && !appVersion) {
        this.warnings.push({
          code: 'VERSION_BUMP_NEEDED',
          message: 'Des fichiers src/*.js existent mais APP_VERSION non trouvé',
          details: 'Vérifiez que APP_VERSION est défini dans index.html',
          fix: 'Ajouter APP_VERSION dans index.html'
        })
      }
    } catch (error) {
      this.warnings.push({
        code: 'VERSION_CHECK_FAILED',
        message: 'Impossible de vérifier les versions',
        details: error.message,
        fix: 'Vérifier que index.html et sw.js existent'
      })
    }
    
    console.log('   ✓ Vérification des versions terminée\n')
  }

  /**
   * Vérifie les fichiers critiques
   */
  async checkCriticalFiles() {
    console.log('📁 Vérification des fichiers critiques...')
    
    const criticalFiles = [
      'index.html',
      'sw.js',
      'manifest.webmanifest',
      'src/lib.js',
      'src/i18n.js',
      'src/learn-core.js'
    ]
    
    const missingFiles = []
    
    for (const file of criticalFiles) {
      try {
        const filePath = join(REPO_ROOT, file)
        await readFile(filePath, 'utf8')
      } catch (error) {
        missingFiles.push(file)
      }
    }
    
    if (missingFiles.length > 0) {
      this.errors.push({
        code: 'MISSING_CRITICAL_FILES',
        message: `Fichiers critiques manquants: ${missingFiles.join(', ')}`,
        details: 'Ces fichiers sont essentiels pour le fonctionnement de SwiperNews',
        fix: `Créer les fichiers manquants: ${missingFiles.join(', ')}`
      })
    } else {
      this.checks.push({
        code: 'ALL_CRITICAL_FILES_PRESENT',
        message: 'Tous les fichiers critiques sont présents',
        status: '✅'
      })
    }
    
    console.log('   ✓ Vérification des fichiers critiques terminée\n')
  }

  /**
   * Vérifie la gestion des erreurs
   */
  async checkErrorHandling() {
    console.log('🛡️  Vérification de la gestion des erreurs...')
    
    try {
      const indexHtmlPath = join(REPO_ROOT, 'index.html')
      const indexContent = await readFile(indexHtmlPath, 'utf8')
      
      // Vérifier la présence de try/catch
      const tryCount = (indexContent.match(/\btry\b/g) || []).length
      const catchCount = (indexContent.match(/\bcatch\b/g) || []).length
      
      if (tryCount === 0 || catchCount === 0) {
        this.warnings.push({
          code: 'NO_ERROR_HANDLING',
          message: 'Peu ou pas de gestion d\'erreurs (try/catch) dans index.html',
          details: `try: ${tryCount}, catch: ${catchCount}`,
          fix: 'Ajouter try/catch autour des opérations critiques (cache, localStorage, etc.)'
        })
      } else {
        this.checks.push({
          code: 'ERROR_HANDLING_PRESENT',
          message: `Gestion d'erreurs présente (${tryCount} try, ${catchCount} catch)`,
          status: '✅'
        })
      }
      
      // Vérifier localStorage avec try/catch
      const localStorageMatches = [...indexContent.matchAll(/localStorage\s*[\.\[]/g)]
      if (localStorageMatches.length > 0) {
        const hasLocalStorageTry = localStorageMatches.some(m => {
          const before = indexContent.substring(0, m.index)
          return before.includes('try')
        })
        
        if (!hasLocalStorageTry) {
          this.warnings.push({
            code: 'LOCALSTORAGE_NO_TRY_CATCH',
            message: 'localStorage utilisé sans protection try/catch',
            details: `${localStorageMatches.length} utilisations de localStorage trouvées`,
            fix: 'Envelopper les accès localStorage dans try/catch'
          })
        }
      }
      
      // Vérifier JSON.parse avec try/catch
      const jsonParseMatches = [...indexContent.matchAll(/JSON\.parse/g)]
      if (jsonParseMatches.length > 0) {
        const hasJsonParseTry = jsonParseMatches.some(m => {
          const before = indexContent.substring(0, m.index)
          return before.includes('try')
        })
        
        if (!hasJsonParseTry) {
          this.warnings.push({
            code: 'JSON_PARSE_NO_TRY_CATCH',
            message: 'JSON.parse utilisé sans protection try/catch',
            details: `${jsonParseMatches.length} utilisations de JSON.parse trouvées`,
            fix: 'Envelopper les JSON.parse dans try/catch'
          })
        }
      }
    } catch (error) {
      this.warnings.push({
        code: 'ERROR_HANDLING_CHECK_FAILED',
        message: 'Impossible de vérifier la gestion des erreurs',
        details: error.message,
        fix: 'Vérifier que index.html existe'
      })
    }
    
    console.log('   ✓ Vérification de la gestion des erreurs terminée\n')
  }

  /**
   * Vérifie la configuration CapacitorHttp
   */
  async checkCapacitorHttp() {
    console.log('📱 Vérification de la configuration CapacitorHttp...')
    
    try {
      const capConfigPath = join(REPO_ROOT, 'capacitor.config.json')
      const capConfigContent = await readFile(capConfigPath, 'utf8')
      
      // Vérifier si CapacitorHttp est activé globalement
      const hasCapacitorHttp = capConfigContent.includes('CapacitorHttp')
      const isCommented = capConfigContent.includes('// CapacitorHttp') ||
                         capConfigContent.includes('/* CapacitorHttp')
      
      if (hasCapacitorHttp && !isCommented) {
        this.errors.push({
          code: 'CAPACITOR_HTTP_GLOBAL',
          message: 'CapacitorHttp semble activé globalement dans capacitor.config.json',
          details: 'CapacitorHttp global ralentit Wikipédia (mesuré : ~3,2s vs direct)',
          fix: 'Désactiver CapacitorHttp globalement, utiliser nativeGet() explicitement pour les flux RSS'
        })
      } else {
        this.checks.push({
          code: 'CAPACITOR_HTTP_OK',
          message: 'CapacitorHttp non activé globalement',
          status: '✅'
        })
      }
      
      // Vérifier l'utilisation de nativeGet dans index.html
      const indexHtmlPath = join(REPO_ROOT, 'index.html')
      const indexContent = await readFile(indexHtmlPath, 'utf8')
      
      const hasNativeGet = indexContent.includes('nativeGet')
      
      if (!hasNativeGet) {
        this.warnings.push({
          code: 'NO_NATIVE_GET',
          message: 'nativeGet() non trouvé dans index.html',
          details: 'nativeGet est nécessaire pour les flux RSS dans l\'APK',
          fix: 'Ajouter nativeGet() pour les requêtes RSS'
        })
      } else {
        this.checks.push({
          code: 'NATIVE_GET_PRESENT',
          message: 'nativeGet() présent dans index.html',
          status: '✅'
        })
      }
    } catch (error) {
      this.warnings.push({
        code: 'CAPACITOR_CHECK_FAILED',
        message: 'Impossible de vérifier la configuration Capacitor',
        details: error.message,
        fix: 'Vérifier que capacitor.config.json existe'
      })
    }
    
    console.log('   ✓ Vérification de CapacitorHttp terminée\n')
  }

  /**
   * Vérifie les aspects de sécurité
   */
  async checkSecurity() {
    console.log('🔒 Vérification de la sécurité...')
    
    try {
      const indexHtmlPath = join(REPO_ROOT, 'index.html')
      const indexContent = await readFile(indexHtmlPath, 'utf8')
      
      // Vérifier l'absence de eval()
      const evalMatches = [...indexContent.matchAll(/\beval\s*\(/g)]
      if (evalMatches.length > 0) {
        this.errors.push({
          code: 'EVAL_FOUND',
          message: `eval() trouvé ${evalMatches.length} fois dans index.html`,
          details: 'eval() est dangereux et doit être évité',
          fix: 'Remplacer eval() par une alternative sûre'
        })
      } else {
        this.checks.push({
          code: 'NO_EVAL',
          message: 'Pas de eval() trouvé',
          status: '✅'
        })
      }
      
      // Vérifier l'absence de innerHTML non sanitized
      const innerHtmlMatches = [...indexContent.matchAll(/\.innerHTML\s*=/g)]
      if (innerHtmlMatches.length > 0) {
        this.warnings.push({
          code: 'INNERHTML_USAGE',
          message: `innerHTML utilisé ${innerHtmlMatches.length} fois`,
          details: 'innerHTML peut causer des vulnérabilités XSS',
          fix: 'Utiliser textContent ou sanitizer pour innerHTML'
        })
      }
      
      // Vérifier la présence de CSP
      const manifestPath = join(REPO_ROOT, 'manifest.webmanifest')
      const vercelJsonPath = join(REPO_ROOT, 'vercel.json')
      
      try {
        const vercelContent = await readFile(vercelJsonPath, 'utf8')
        const hasCSP = vercelContent.includes('Content-Security-Policy') ||
                      vercelContent.includes('CSP')
        
        if (hasCSP) {
          this.checks.push({
            code: 'CSP_PRESENT',
            message: 'CSP configuré dans vercel.json',
            status: '✅'
          })
        } else {
          this.warnings.push({
            code: 'NO_CSP',
            message: 'Aucune CSP (Content Security Policy) trouvée',
            details: 'CSP est important pour la sécurité',
            fix: 'Configurer CSP dans vercel.json'
          })
        }
      } catch (error) {
        // vercel.json non trouvé, ignorer
      }
    } catch (error) {
      this.warnings.push({
        code: 'SECURITY_CHECK_FAILED',
        message: 'Impossible de vérifier la sécurité',
        details: error.message,
        fix: 'Vérifier que index.html existe'
      })
    }
    
    console.log('   ✓ Vérification de la sécurité terminée\n')
  }

  /**
   * Vérifie le style de code
   */
  async checkCodeStyle() {
    console.log('🎨 Vérification du style de code...')
    
    // Vérifier que .prettierignore exclut index.html
    try {
      const prettierIgnorePath = join(REPO_ROOT, '.prettierignore')
      const prettierIgnoreContent = await readFile(prettierIgnorePath, 'utf8')
      
      if (!prettierIgnoreContent.includes('index.html')) {
        this.warnings.push({
          code: 'INDEX_HTML_NOT_IGNORED',
          message: 'index.html non exclu de .prettierignore',
          details: 'index.html doit être exclu car le JS/CSS en ligne est dense à dessein',
          fix: 'Ajouter index.html à .prettierignore'
        })
      } else {
        this.checks.push({
          code: 'INDEX_HTML_IGNORED',
          message: 'index.html correctement exclu de .prettierignore',
          status: '✅'
        })
      }
      
      if (!prettierIgnoreContent.includes('README.md')) {
        this.warnings.push({
          code: 'README_NOT_IGNORED',
          message: 'README.md non exclu de .prettierignore',
          details: 'README.md doit être exclu pour préserver le format',
          fix: 'Ajouter README.md à .prettierignore'
        })
      }
    } catch (error) {
      this.warnings.push({
        code: 'PRETTIER_IGNORE_CHECK_FAILED',
        message: 'Impossible de vérifier .prettierignore',
        details: error.message,
        fix: 'Vérifier que .prettierignore existe'
      })
    }
    
    console.log('   ✓ Vérification du style de code terminée\n')
  }

  /**
   * Vérifie les tests
   */
  async checkTests() {
    console.log('🧪 Vérification des tests...')
    
    try {
      const testDir = join(REPO_ROOT, 'test')
      const testFiles = await readdir(testDir)
      
      const jsTestFiles = testFiles.filter(f => f.endsWith('.test.js'))
      
      if (jsTestFiles.length === 0) {
        this.warnings.push({
          code: 'NO_TEST_FILES',
          message: 'Aucun fichier de test trouvé',
          details: 'Les tests sont importants pour la qualité du code',
          fix: 'Ajouter des tests dans le dossier test/'
        })
      } else {
        this.checks.push({
          code: 'TEST_FILES_PRESENT',
          message: `${jsTestFiles.length} fichiers de test trouvés`,
          status: '✅'
        })
      }
      
      // Vérifier la présence de npm test dans package.json
      const pkgPath = join(REPO_ROOT, 'package.json')
      const pkgContent = await readFile(pkgPath, 'utf8')
      const pkg = JSON.parse(pkgContent)
      
      if (!pkg.scripts || !pkg.scripts.test) {
        this.warnings.push({
          code: 'NO_TEST_SCRIPT',
          message: 'Aucun script "test" trouvé dans package.json',
          details: 'Le script test est nécessaire pour exécuter les tests',
          fix: 'Ajouter "test": "node --test test/*.test.js" à package.json'
        })
      } else {
        this.checks.push({
          code: 'TEST_SCRIPT_PRESENT',
          message: 'Script "test" présent dans package.json',
          status: '✅'
        })
      }
    } catch (error) {
      this.warnings.push({
        code: 'TEST_CHECK_FAILED',
        message: 'Impossible de vérifier les tests',
        details: error.message,
        fix: 'Vérifier que le dossier test/ existe'
      })
    }
    
    console.log('   ✓ Vérification des tests terminée\n')
  }

  /**
   * Affiche les résultats
   */
  displayResults() {
    console.log('='.repeat(60))
    console.log('  RÉSULTATS DE LA VÉRIFICATION PRÉ-COMMIT')
    console.log('='.repeat(60))
    console.log()

    // Vérifications passées
    if (this.checks.length > 0) {
      console.log('✅ Vérifications passées:')
      console.log('-'.repeat(40))
      for (const check of this.checks) {
        console.log(`  ${check.status} ${check.message}`)
      }
      console.log()
    }

    // Avertissements
    if (this.warnings.length > 0) {
      console.log('⚠️  Avertissements:')
      console.log('-'.repeat(40))
      for (const warning of this.warnings) {
        console.log(`  [${warning.code}] ${warning.message}`)
        console.log(`    → ${warning.fix}`)
      }
      console.log()
    }

    // Erreurs
    if (this.errors.length > 0) {
      console.log('❌ Erreurs critiques:')
      console.log('-'.repeat(40))
      for (const error of this.errors) {
        console.log(`  [${error.code}] ${error.message}`)
        console.log(`    → ${error.fix}`)
      }
      console.log()
    }

    console.log('='.repeat(60))
  }
}

// Exécution
async function main() {
  const checker = new SwiperNewsChecker()
  await checker.check()
}

main().catch(console.error)

export default SwiperNewsChecker
