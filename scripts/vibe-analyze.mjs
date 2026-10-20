#!/usr/bin/env node

/**
 * vibe-analyze.js - Script d'analyse du repository SwiperNews
 * 
 * Analyse la structure, la stack technique, les workflows et la documentation
 * pour fournir un rapport complet sur l'état du projet.
 * 
 * @module vibe-analyze
 */

import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

/**
 * Analyseur de repository SwiperNews
 */
class SwiperNewsAnalyzer {
  constructor() {
    this.report = {
      metadata: {
        analyzedAt: new Date().toISOString(),
        analyzerVersion: '1.0.0'
      },
      structure: {},
      stack: {},
      workflows: {},
      documentation: {},
      issues: [],
      recommendations: []
    }
  }

  /**
   * Analyse complète du repository
   */
  async analyze() {
    console.log('🔍 Analyse du repository SwiperNews...\n')
    
    await this.analyzeStructure()
    await this.analyzeStack()
    await this.analyzeWorkflows()
    await this.analyzeDocumentation()
    await this.checkCriticalRules()
    
    this.generateReport()
    
    return this.report
  }

  /**
   * Analyse la structure des fichiers
   */
  async analyzeStructure() {
    console.log('📁 Analyse de la structure...')
    
    const structure = {
      totalFiles: 0,
      totalDirectories: 0,
      byExtension: {},
      keyFiles: {
        entryPoints: [],
        sourceFiles: [],
        testFiles: [],
        configFiles: [],
        documentationFiles: []
      },
      directoryTree: {}
    }

    const scanDirectory = async (dirPath, relativePath = '') => {
      try {
        const entries = await readdir(dirPath, { withFileTypes: true })
        
        for (const entry of entries) {
          const fullPath = join(dirPath, entry.name)
          const relPath = relativePath ? join(relativePath, entry.name) : entry.name
          const ext = extname(entry.name).toLowerCase()
          
          if (entry.isDirectory()) {
            // Ignorer certains dossiers
            if (entry.name === 'node_modules' || entry.name === '.git' || 
                entry.name === 'www' || entry.name === 'android') {
              continue
            }
            
            structure.totalDirectories++
            structure.directoryTree[relPath] = {}
            
            await scanDirectory(fullPath, relPath)
          } else if (entry.isFile()) {
            structure.totalFiles++
            
            // Compter par extension
            structure.byExtension[ext] = (structure.byExtension[ext] || 0) + 1
            
            // Identifier les fichiers clés
            const filePath = relative(REPO_ROOT, fullPath)
            
            if (relPath === '' || relativePath.startsWith('.github') || 
                relativePath.startsWith('scripts')) {
              structure.keyFiles.configFiles.push(filePath)
            }
            
            if (ext === '.js' && !filePath.includes('node_modules')) {
              if (filePath.includes('test/')) {
                structure.keyFiles.testFiles.push(filePath)
              } else if (filePath.includes('src/') || filePath.includes('api/')) {
                structure.keyFiles.sourceFiles.push(filePath)
              }
            }
            
            if (ext === '.md' || ext === '.txt' || ext === '.rst') {
              structure.keyFiles.documentationFiles.push(filePath)
            }
            
            if (entry.name === 'index.html' || entry.name === 'sw.js' ||
                entry.name === 'manifest.webmanifest') {
              structure.keyFiles.entryPoints.push(filePath)
            }
          }
        }
      } catch (error) {
        console.warn(`⚠️  Erreur lors du scan de ${dirPath}: ${error.message}`)
      }
    }

    await scanDirectory(REPO_ROOT)
    
    this.report.structure = structure
    console.log(`   ✓ ${structure.totalFiles} fichiers, ${structure.totalDirectories} dossiers analysés\n`)
  }

  /**
   * Analyse la stack technique
   */
  async analyzeStack() {
    console.log('🛠️  Analyse de la stack technique...')
    
    const stack = {
      frontend: {
        languages: [],
        frameworks: [],
        buildTools: [],
        features: []
      },
      backend: {
        provider: '',
        functions: [],
        runtime: ''
      },
      mobile: {
        framework: '',
        platform: '',
        sdk: { min: '', target: '', compile: '' }
      },
      devTools: {
        linters: [],
        formatters: [],
        testRunners: []
      },
      dependencies: {
        production: [],
        development: []
      }
    }

    // Lire package.json
    try {
      const pkgPath = join(REPO_ROOT, 'package.json')
      const pkgContent = await readFile(pkgPath, 'utf8')
      const pkg = JSON.parse(pkgContent)
      
      stack.frontend.languages.push('HTML', 'CSS', 'JavaScript')
      stack.frontend.features.push('PWA', 'Service Worker', 'Zero Build')
      
      stack.backend.provider = 'Vercel'
      stack.backend.runtime = 'Node.js'
      
      stack.devTools.linters.push('ESLint')
      stack.devTools.formatters.push('Prettier')
      stack.devTools.testRunners.push('Node.js Test Runner')
      
      if (pkg.dependencies) {
        for (const [name, version] of Object.entries(pkg.dependencies)) {
          stack.dependencies.production.push(`${name}@${version}`)
        }
      }
      
      if (pkg.devDependencies) {
        for (const [name, version] of Object.entries(pkg.devDependencies)) {
          stack.dependencies.development.push(`${name}@${version}`)
          
          if (name.includes('capacitor')) {
            stack.mobile.framework = 'Capacitor'
            stack.mobile.platform = 'Android'
          }
        }
      }
      
      if (pkg.scripts) {
        stack.frontend.buildTools = Object.keys(pkg.scripts)
      }
    } catch (error) {
      console.warn(`⚠️  Impossible de lire package.json: ${error.message}`)
    }

    // Lire capacitor.config.json
    try {
      const capConfigPath = join(REPO_ROOT, 'capacitor.config.json')
      const capConfigContent = await readFile(capConfigPath, 'utf8')
      const capConfig = JSON.parse(capConfigContent)
      
      stack.mobile.framework = 'Capacitor'
      stack.mobile.platform = 'Android'
    } catch (error) {
      // Capacitor config non trouvé
    }

    // Lire android/variables.gradle
    try {
      const gradlePath = join(REPO_ROOT, 'android', 'variables.gradle')
      const gradleContent = await readFile(gradlePath, 'utf8')
      
      const minSdkMatch = gradleContent.match(/minSdk\s+(\d+)/)
      const targetSdkMatch = gradleContent.match(/targetSdk\s+(\d+)/)
      const compileSdkMatch = gradleContent.match(/compileSdk\s+(\d+)/)
      
      if (minSdkMatch) stack.mobile.sdk.min = minSdkMatch[1]
      if (targetSdkMatch) stack.mobile.sdk.target = targetSdkMatch[1]
      if (compileSdkMatch) stack.mobile.sdk.compile = compileSdkMatch[1]
    } catch (error) {
      // Gradle variables non trouvé
    }

    // Détecter les API serverless
    try {
      const apiDir = join(REPO_ROOT, 'api')
      const apiFiles = await readdir(apiDir)
      
      for (const file of apiFiles) {
        if (file.endsWith('.js')) {
          stack.backend.functions.push(file)
        }
      }
    } catch (error) {
      // Dossier api non trouvé
    }

    this.report.stack = stack
    console.log(`   ✓ Stack identifiée: ${stack.frontend.languages.join(', ')} + ${stack.mobile.framework}\n`)
  }

  /**
   * Analyse les workflows CI/CD
   */
  async analyzeWorkflows() {
    console.log('⚙️  Analyse des workflows CI/CD...')
    
    const workflows = {
      available: [],
      triggers: {},
      jobs: {}
    }

    try {
      const workflowsDir = join(REPO_ROOT, '.github', 'workflows')
      const workflowFiles = await readdir(workflowsDir)
      
      for (const file of workflowFiles) {
        if (file.endsWith('.yml') || file.endsWith('.yaml')) {
          const workflowPath = join(workflowsDir, file)
          const content = await readFile(workflowPath, 'utf8')
          
          const workflow = {
            name: file.replace(/\.(yml|yaml)$/, ''),
            file: file,
            triggers: [],
            jobs: []
          }

          // Extraire les triggers
          const onMatch = content.match(/^on:\s*\n((?:\s+[^\n]+\n+)*)/m)
          if (onMatch) {
            const triggersContent = onMatch[1]
            if (triggersContent.includes('push:')) {
              workflow.triggers.push('push')
            }
            if (triggersContent.includes('pull_request:')) {
              workflow.triggers.push('pull_request')
            }
            if (triggersContent.includes('workflow_dispatch:')) {
              workflow.triggers.push('manual')
            }
            if (triggersContent.includes('tags:')) {
              workflow.triggers.push('tags')
            }
          }

          // Extraire les jobs
          const jobsMatch = content.match(/^jobs:\s*\n((?:\s+[^\n]+\n+)*)/m)
          if (jobsMatch) {
            const jobsContent = jobsMatch[1]
            const jobMatches = jobsContent.match(/^\s+(\w+):/gm)
            if (jobMatches) {
              workflow.jobs = jobMatches.map(m => m.trim().replace(/:$/, ''))
            }
          }

          workflows.available.push(workflow)
          
          // Indexer par nom
          workflows.jobs[workflow.name] = workflow.jobs
        }
      }
    } catch (error) {
      console.warn(`⚠️  Impossible de lire les workflows: ${error.message}`)
    }

    this.report.workflows = workflows
    console.log(`   ✓ ${workflows.available.length} workflows identifiés\n`)
  }

  /**
   * Analyse la documentation
   */
  async analyzeDocumentation() {
    console.log('📚 Analyse de la documentation...')
    
    const documentation = {
      primary: [],
      secondary: [],
      skills: [],
      totalLines: 0
    }

    // Documentation principale
    const primaryDocs = [
      'README.md',
      'AGENTS.md',
      '.vibe/instructions.md',
      '.github/PULL_REQUEST_TEMPLATE.md'
    ]

    for (const doc of primaryDocs) {
      try {
        const docPath = join(REPO_ROOT, doc)
        const stats = await stat(docPath)
        const content = await readFile(docPath, 'utf8')
        
        documentation.primary.push({
          file: doc,
          size: stats.size,
          lines: content.split('\n').length
        })
        documentation.totalLines += content.split('\n').length
      } catch (error) {
        // Document non trouvé
      }
    }

    // Documentation secondaire
    const secondaryPatterns = [
      'AUDIT',
      '.md'
    ]

    try {
      const docsDir = join(REPO_ROOT, 'docs')
      const docsFiles = await readdir(docsDir, { recursive: true })
      
      for (const file of docsFiles) {
        if (file.endsWith('.md')) {
          const filePath = join('docs', file)
          try {
            const content = await readFile(join(REPO_ROOT, filePath), 'utf8')
            documentation.secondary.push({
              file: filePath,
              lines: content.split('\n').length
            })
            documentation.totalLines += content.split('\n').length
          } catch (error) {
            // Ignorer
          }
        }
      }
    } catch (error) {
      // Dossier docs non trouvé
    }

    // Skills Claude
    try {
      const claudeDir = join(REPO_ROOT, '.claude', 'skills')
      const skills = await readdir(claudeDir)
      
      for (const skill of skills) {
        const skillPath = join('.claude', 'skills', skill)
        const skillFiles = await readdir(join(REPO_ROOT, skillPath))
        
        documentation.skills.push({
          name: skill,
          files: skillFiles
        })
      }
    } catch (error) {
      // Skills non trouvés
    }

    this.report.documentation = documentation
    console.log(`   ✓ ${documentation.primary.length + documentation.secondary.length} documents, ${documentation.totalLines} lignes\n`)
  }

  /**
   * Vérifie les règles critiques
   */
  async checkCriticalRules() {
    console.log('⚠️  Vérification des règles critiques...')
    
    const issues = []
    const recommendations = []

    // Vérifier la cohérence des versions
    try {
      const indexHtmlPath = join(REPO_ROOT, 'index.html')
      const indexContent = await readFile(indexHtmlPath, 'utf8')
      
      const swJsPath = join(REPO_ROOT, 'sw.js')
      const swContent = await readFile(swJsPath, 'utf8')
      
      // Extraire APP_VERSION
      const appVersionMatch = indexContent.match(/APP_VERSION:\s*["']([^"']+)["']/)
      // Extraire version dans sw.js
      const cacheVersionMatch = swContent.match(/const CACHE = ["']flux-v(\d+)["']/)
      // Extraire version dans les scripts
      const scriptVersionMatches = indexContent.matchAll(/src\/([^.]+)\.js\?v=(\d+)/g)
      
      if (appVersionMatch && cacheVersionMatch) {
        const appVersion = appVersionMatch[1]
        const cacheVersion = cacheVersionMatch[1]
        
        // Vérifier que les versions sont cohérentes
        if (scriptVersionMatches) {
          const scriptVersions = Array.from(scriptVersionMatches, m => m[2])
          const uniqueVersions = [...new Set(scriptVersions)]
          
          if (uniqueVersions.length > 1) {
            issues.push({
              severity: 'high',
              message: 'Incohérence des versions dans les scripts src/*.js',
              details: `Versions trouvées: ${uniqueVersions.join(', ')}`,
              fix: 'Mettre à jour tous les ?v= avec la même version'
            })
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️  Impossible de vérifier les versions: ${error.message}`)
    }

    // Vérifier la présence de try/catch autour du cache
    try {
      const indexHtmlPath = join(REPO_ROOT, 'index.html')
      const indexContent = await readFile(indexHtmlPath, 'utf8')
      
      if (!indexContent.includes('try') || !indexContent.includes('catch')) {
        recommendations.push({
          severity: 'medium',
          message: 'Peu ou pas de gestion d\'erreurs visible dans index.html',
          details: 'Les opérations de cache devraient être protégées par try/catch',
          fix: 'Ajouter try/catch autour des lectures de cache'
        })
      }
    } catch (error) {
      // Ignorer
    }

    // Vérifier la présence de CapacitorHttp dans capacitor.config.json
    try {
      const capConfigPath = join(REPO_ROOT, 'capacitor.config.json')
      const capConfigContent = await readFile(capConfigPath, 'utf8')
      
      if (capConfigContent.includes('CapacitorHttp') && 
          !capConfigContent.includes('//')) {
        issues.push({
          severity: 'critical',
          message: 'CapacitorHttp semble activé globalement dans capacitor.config.json',
          details: 'CapacitorHttp doit être appelé explicitement via nativeGet() pour les flux RSS seulement',
          fix: 'Désactiver CapacitorHttp globalement, utiliser nativeGet() explicitement'
        })
      }
    } catch (error) {
      // Ignorer
    }

    this.report.issues = issues
    this.report.recommendations = recommendations
    
    console.log(`   ✓ ${issues.length} problèmes critiques, ${recommendations.length} recommandations\n`)
  }

  /**
   * Génère le rapport final
   */
  generateReport() {
    console.log('📊 Génération du rapport...\n')
    console.log('='.repeat(60))
    console.log('  RAPPORT D\'ANALYSE - SWIPERNEWS')
    console.log('='.repeat(60))
    console.log()

    // Structure
    console.log('📁 STRUCTURE')
    console.log('-'.repeat(40))
    console.log(`  Fichiers: ${this.report.structure.totalFiles}`)
    console.log(`  Dossiers: ${this.report.structure.totalDirectories}`)
    console.log()
    console.log('  Extensions principales:')
    const sortedExtensions = Object.entries(this.report.structure.byExtension)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
    for (const [ext, count] of sortedExtensions) {
      console.log(`    ${ext || '(no ext)'}: ${count}`)
    }
    console.log()

    // Stack
    console.log('🛠️  STACK TECHNIQUE')
    console.log('-'.repeat(40))
    console.log(`  Frontend: ${this.report.stack.frontend.languages.join(', ')}`)
    console.log(`  Framework Mobile: ${this.report.stack.mobile.framework}`)
    console.log(`  Backend: ${this.report.stack.backend.provider} (${this.report.stack.backend.runtime})`)
    console.log(`  SDK Android: min=${this.report.stack.mobile.sdk.min}, target=${this.report.stack.mobile.sdk.target}`)
    console.log()

    // Workflows
    console.log('⚙️  WORKFLOWS CI/CD')
    console.log('-'.repeat(40))
    for (const workflow of this.report.workflows.available) {
      console.log(`  ${workflow.name}:`)
      console.log(`    Triggers: ${workflow.triggers.join(', ')}`)
      console.log(`    Jobs: ${workflow.jobs.join(', ')}`)
    }
    console.log()

    // Documentation
    console.log('📚 DOCUMENTATION')
    console.log('-'.repeat(40))
    console.log(`  Documents primaires: ${this.report.documentation.primary.length}`)
    for (const doc of this.report.documentation.primary) {
      console.log(`    - ${doc.file} (${doc.lines} lignes)`)
    }
    console.log(`  Documents secondaires: ${this.report.documentation.secondary.length}`)
    console.log(`  Skills Claude: ${this.report.documentation.skills.length}`)
    console.log(`  Total: ${this.report.documentation.totalLines} lignes`)
    console.log()

    // Issues
    if (this.report.issues.length > 0) {
      console.log('❌ PROBLÈMES CRITIQUES')
      console.log('-'.repeat(40))
      for (const issue of this.report.issues) {
        console.log(`  [${issue.severity.toUpperCase()}] ${issue.message}`)
        console.log(`    → ${issue.fix}`)
      }
      console.log()
    }

    // Recommandations
    if (this.report.recommendations.length > 0) {
      console.log('💡 RECOMMANDATIONS')
      console.log('-'.repeat(40))
      for (const rec of this.report.recommendations) {
        console.log(`  [${rec.severity.toUpperCase()}] ${rec.message}`)
        console.log(`    → ${rec.fix}`)
      }
      console.log()
    }

    console.log('='.repeat(60))
    console.log('  Analyse terminée')
    console.log('='.repeat(60))
    console.log()
  }
}

// Exécution
async function main() {
  const analyzer = new SwiperNewsAnalyzer()
  await analyzer.analyze()
  
  // Sauvegarder le rapport en JSON
  const reportPath = join(REPO_ROOT, '.vibe', 'analysis-report.json')
  const reportContent = JSON.stringify(analyzer.report, null, 2)
  
  try {
    await writeFile(reportPath, reportContent, 'utf8')
    console.log(`✅ Rapport sauvegardé: .vibe/analysis-report.json\n`)
  } catch (error) {
    console.error(`❌ Erreur lors de la sauvegarde du rapport: ${error.message}\n`)
  }
}

main().catch(console.error)

export default SwiperNewsAnalyzer
