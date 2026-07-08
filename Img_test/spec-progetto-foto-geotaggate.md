# App Android — Foto Geotaggate di Progetto (Sopralluoghi)

Specifica tecnica completa. App nativa Android, locale, nessun backend, nessun account esterno. Sviluppo target: Claude Code.

---

## 1. Scopo e contesto d'uso

App per documentazione fotografica professionale durante **sopralluoghi tecnici/cantiere**. Priorità di design: velocità di scatto, robustezza (nessuna perdita dati), usabilità in esterno con luce forte/guanti, integrità probante delle foto.

Non è un'app consumer: ogni scelta tecnica privilegia affidabilità e leggerezza sulle risorse rispetto a funzionalità superflue.

---

## 2. Stack tecnico

| Componente | Scelta | Note |
|---|---|---|
| Linguaggio | Kotlin | — |
| minSdk / targetSdk | 26 / 35 | CameraX e scoped storage richiedono ≥26 in pratica |
| Modulo Gradle | Singolo modulo | Scope non giustifica multi-modulo |
| Camera | CameraX **1.5.1** | core, camera2, lifecycle, view |
| Posizione | `android.location.LocationManager` **nativo** | Scelto al posto di play-services-location per evitare dipendenza da Google Play Services e ridurre footprint. Richiede gestione manuale multi-provider (GPS + rete) |
| Indirizzo (reverse geocoding) | `android.location.Geocoder` **nativo** | Best-effort, non garantito su tutti i device, mai bloccante |
| Sensori | `SensorManager` nativo | Barometro (pressione/quota) e magnetometro (bussola), entrambi opzionali con check di disponibilità runtime |
| EXIF | `androidx.exifinterface` (1.3.x) | Scrittura GPS, datetime |
| Persistenza strutturata | Room **2.8.4** | Non Room 3.0 (ancora alpha) |
| Impostazioni | DataStore Preferences (1.1.x) | Sostituisce SharedPreferences |
| Thumbnail griglia | Coil3 **3.5.0**, solo modulo `coil-compose` | Nessun modulo network: immagini sempre locali |
| Audio note | `MediaRecorder` nativo | — |
| Voice-to-text | `SpeechRecognizer` nativo | Fallback automatico a testo scritto se non disponibile/fallisce |
| Storage file | **SAF** (Storage Access Framework) | `DocumentFile`, tree URI persistente, no MediaStore, no storage app-specific |
| Sicurezza/integrità | `Android Keystore` (firma), `MessageDigest SHA-256` | Nessuna libreria esterna |

---

## 3. Struttura moduli (package)

```
data/       → Room (entities, DAO, database), repository, DataStore
domain/     → use case (CreateProject, CapturePhoto, DeleteProject, SearchAll, VerifyIntegrity, ...)
camera/     → CameraX setup, ImageCapture wrapper, overlay live viewfinder
storage/    → SAF helper (DocumentFile ops, persistable permissions, scrittura atomica)
exif/       → wrapper scrittura EXIF/GPS
location/   → LocationManager wrapper, multi-provider, cache 5 min, staleness
sensors/    → barometro (quota/pressione), magnetometro (bussola)
security/   → hash SHA-256, firma Keystore, verifica integrità, tag no-AI
ui/         → schermate (Compose)
```

---

## 4. Modello dati (Room)

```kotlin
@Entity
data class Project(
    @PrimaryKey val id: String,
    val nome: String,
    val treeUriString: String,
    val folderDocumentId: String,
    val customOverlayText: String?,
    val captureModeOverride: CaptureMode?, // null = usa impostazione globale
    val createdAt: Long
)

enum class CaptureMode { RAPID, WITH_NOTE }

@Entity
data class Photo(
    @PrimaryKey val id: String,
    val projectId: String,               // FK → Project, cascade delete
    val documentUriString: String,
    val fileName: String,
    val photoIndex: Int,                  // progressivo per progetto (001, 002, ...)

    // Geolocalizzazione
    val latitude: Double?,
    val longitude: Double?,
    val locationTimestamp: Long?,
    val isLocationStale: Boolean,         // true se fix >5 min al momento dello scatto

    // Sensori aggiuntivi
    val altitudeMeters: Double?,
    val altitudeSource: AltitudeSource,    // BAROMETER | GPS | NONE
    val pressureHpa: Double?,

    // Overlay
    val timestampUtc: Long,
    val labelSnapshot: String,            // testo overlay esatto bruciato nel bitmap
    val linesBurned: Boolean,             // linee di riferimento bruciate o solo viewfinder

    // Note (modificabili sempre, indipendenti dall'overlay)
    val noteText: String?,
    val noteAudioUriString: String?,

    // Integrità
    val contentHash: String,              // SHA-256 del JPEG al salvataggio
    val contentSignature: String,         // firma Keystore dell'hash, base64
    val aiOptOutEmbedded: Boolean
)

enum class AltitudeSource { BAROMETER, GPS, NONE }
```

---

## 5. Impostazioni globali (DataStore)

```
overlay_custom_text_enabled: Boolean
overlay_coordinates_enabled: Boolean
overlay_address_enabled: Boolean
overlay_datetime_enabled: Boolean
overlay_datetime_format: String
overlay_altitude_enabled: Boolean
overlay_pressure_enabled: Boolean

default_capture_mode: CaptureMode (RAPID | WITH_NOTE)

jpeg_quality: Int (0-100)
flash_mode: AUTO | ON | OFF
composition_grid_enabled: Boolean          // griglia 3x3 fissa
aspect_ratio: RATIO_4_3 | RATIO_16_9
reference_lines_config: JSON [{orientamento: V|H, posizione: 0.0-1.0}]
reference_lines_burn_last_used: Boolean    // stato ricordato del toggle rapido in camera
```

Ogni toggle overlay è **indipendente** e si applica solo se il dato è disponibile per quello scatto specifico (nessun placeholder "N/D", la riga semplicemente non compare).

`Project.captureModeOverride` sovrascrive `default_capture_mode` se valorizzato.

---

## 6. Flusso di scatto (ordine operazioni)

1. **Overlay live nel mirino** (WYSIWYG): stesso codice di formattazione testo usato per il bitmap finale, disegnato sopra il `PreviewView` — testo progetto, coordinate, data/ora aggiornata al secondo, quota/pressione se disponibili
2. Utente scatta (`CameraX ImageCapture.takePicture()` → `ImageProxy` in memoria)
3. Recupero posizione da cache (vedi §7 — nessuna attesa fix fresco bloccante)
4. Conversione `ImageProxy` → `Bitmap`
5. Disegno overlay finale su `Canvas`: testo progetto, coordinate, indirizzo (se disponibile), data/ora, quota, pressione, linee di riferimento (se il toggle rapido "fissa linee" è attivo)
6. Compressione JPEG (qualità da impostazioni)
7. **Scrittura atomica**: file temporaneo in `cacheDir` → verifica completamento → copia/rename nel `DocumentFile` SAF finale (mai scrivere direttamente nella destinazione definitiva)
8. Calcolo hash SHA-256 del JPEG finale, firma con chiave Keystore, scrittura tag no-AI e blocco integrità in EXIF `UserComment`
9. Scrittura EXIF GPS/datetime standard
10. Salvataggio record `Photo` in Room (transazione, `photoIndex` calcolato come `MAX(photoIndex)+1` per il progetto, dentro la stessa transazione per evitare collisioni)
11. Bivio in base a `CaptureMode` risolto (progetto override o globale):
    - **RAPID**: micro-feedback non bloccante (thumbnail fade in/out ~1.5s in un angolo; in caso di errore, icona persistente che richiede tap per essere chiusa) → torna subito al mirino
    - **WITH_NOTE**: apre preview con opzioni nota (scrivi / detta con fallback a scrivi / registra audio — scelte indipendenti, non in cascata automatica salvo Detta→Scrivi)

---

## 7. Posizione (LocationManager nativo)

- Multi-provider: GPS + network provider, logica di scelta del fix più recente/accurato tra i due
- Refresh attivo solo mentre la schermata camera è aperta (lifecycle-bound, mai in vero background)
- Intervallo di refresh: 5 minuti
- Se al momento dello scatto l'ultimo fix è più vecchio di 5 minuti, tentativo di refresh con timeout breve (~10s); se fallisce, si procede con l'ultimo fix disponibile e `isLocationStale = true` + banner di avviso in UI
- Permesso location negato → scatto silenzioso, nessun geotag, **nessun avviso** (comportamento esplicitamente richiesto)

---

## 8. Sensori aggiuntivi

**Quota/pressione** (due toggle indipendenti):
- Barometro (`Sensor.TYPE_PRESSURE`) se disponibile → altitudine calcolata via `SensorManager.getAltitude()`, più stabile del GPS per variazioni relative ma richiede pressione di riferimento per accuratezza assoluta (limite noto, da comunicare in UI se rilevante)
- Se barometro assente → fallback altitudine da GPS (`Location.getAltitude()`, meno preciso)
- Se nessuna fonte disponibile → riga omessa, nessun placeholder

**Indirizzo**: `Geocoder.isPresent()` controllato prima di ogni tentativo; su API ≥33 uso listener asincrono, sotto eseguito su `Dispatchers.IO`; timeout esplicito (~3s) via `withTimeoutOrNull`; mai bloccante per lo scatto.

---

## 9. Note per foto

- Tre modalità di inserimento, indipendenti: **Scrivi** (testo libero) · **Detta** (SpeechRecognizer, fallback automatico a testo scritto se non disponibile/fallisce) · **Registra audio** (MediaRecorder, file separato)
- Testo e audio possono coesistere sulla stessa foto
- **Modificabili in qualsiasi momento** dalla griglia (non solo alla cattura) — a differenza dell'overlay che resta immutabile per sempre
- Sostituzione di una registrazione audio esistente: il vecchio `DocumentFile` audio va cancellato esplicitamente **prima** di scrivere il nuovo URI in Room, per evitare file orfani nella cartella SAF

---

## 10. Storage (SAF)

- Root tree scelto una volta (`ACTION_OPEN_DOCUMENT_TREE`), permesso reso persistente con `takePersistableUriPermission`
- Ogni progetto = sottocartella creata via `DocumentFile.createDirectory()`
- Note audio salvate come file nella stessa cartella progetto
- Nessun uso di MediaStore o storage app-specific (che verrebbe cancellato alla disinstallazione)
- Compatibile nativamente con trasferimento USB/MTP, nessun lavoro aggiuntivo richiesto

---

## 11. Camera — impostazioni

| Impostazione | Dettaglio |
|---|---|
| Qualità JPEG | Slider 0-100% |
| Flash | Auto / On / Off, controllo rapido in UI camera |
| Griglia di composizione | Overlay 3x3 fisso, toggle on/off, mai bruciata nella foto |
| Aspect ratio | 4:3 o 16:9, configurabile |
| Linee di riferimento | Utente aggiunge/rimuove linee verticali/orizzontali posizionabili liberamente nel mirino; **configurazione persistente** tra sessioni (salvata in DataStore come lista JSON); toggle "fissa nella foto" è un **controllo rapido in camera** (non impostazione fissa), stato iniziale = ultimo usato |

---

## 12. Integrità e provenienza

Obiettivo: non impedire tecnicamente la modifica (impossibile su un file posseduto localmente), ma garantire **rilevabilità** di eventuali alterazioni post-scatto e un segnale di opt-out per elaborazione IA.

1. **Hash SHA-256** del JPEG finale calcolato al salvataggio, salvato in `Photo.contentHash`
2. **Firma Keystore**: hash firmato con chiave privata generata in Android Keystore (hardware-backed se supportato dal device), mai esportata, generata una volta all'installazione app → `Photo.contentSignature`
3. **Tag no-AI**: metadato scritto in EXIF `UserComment` (JSON compatto con hash, firma, flag opt-out). Da valutare in fase implementativa se aggiungere anche blocco XMP dedicato (convenzione più riconosciuta per opt-out training IA esterno) oltre al campo EXIF
4. **Verifica integrità** (funzione in `FullScreenPhotoViewer`): ricalcola hash del file corrente, confronta con `contentHash` salvato → "Originale, non modificata" o "Attenzione: file modificato dopo lo scatto"

Nota di trasparenza da mantenere anche in UI utente: il tag no-AI è un segnale volontario (honor-system), non un blocco tecnico enforceable su terzi.

---

## 13. Ricerca

Due sorgenti, presentate come sezioni distinte in un'unica schermata risultati:

```sql
-- Progetti (match sul nome)
SELECT * FROM Project WHERE nome LIKE '%' || :query || '%'

-- Foto (match sulla nota testuale)
SELECT Photo.*, Project.nome AS projectNome
FROM Photo JOIN Project ON Photo.projectId = Project.id
WHERE Photo.noteText LIKE '%' || :query || '%'
```

- Sezione **Progetti**: nome, data creazione, tap → apre griglia progetto
- Sezione **Foto con note corrispondenti**: thumbnail, nome progetto, snippet testo nota, tap → **deep-link diretto** a `FullScreenPhotoViewer` per quella foto specifica, con la griglia del progetto correttamente sotto nello stack di navigazione (back-press torna alla griglia, non alla ricerca)
- Limite noto: le note vocali salvate come solo audio grezzo (senza passare da dettatura) non sono cercabili, non esiste testo associato

---

## 14. Navigazione

```
ProjectListScreen (lista progetti, data creazione desc, barra ricerca)
  → SearchResultsScreen (progetti + foto/note corrispondenti)
  → ProjectDetailScreen (griglia thumbnail, selezione multipla per eliminazione batch)
      → CameraScreen (overlay live, controlli rapidi flash/linee)
          → PreviewScreen (solo se CaptureMode = WITH_NOTE; opzioni nota)
      → FullScreenPhotoViewer (foto singola: elimina, modifica nota, verifica integrità)
```

---

## 15. Gestione progetti e foto — regole di modifica

- **Progetto**: creazione (nome, cartella SAF dedicata, testo overlay opzionale, override capture mode opzionale). Eliminazione = cancellazione completa e irreversibile di tutti i `DocumentFile` (foto + audio note) nella cartella SAF + cascade delete dei record Room + pulizia cache locale. Nessuna pretesa di wiping forense/sicuro (non realistico su storage flash con wear leveling; spiegato esplicitamente se richiesto in UI/documentazione utente)
- **Foto**: uniche azioni post-scatto ammesse sono **eliminazione** (singola o batch via selezione multipla in griglia) e **modifica/sostituzione nota**. Overlay ed EXIF geografico restano immutabili per sempre una volta scattata la foto

---

## 16. Permessi runtime

| Permesso | Comportamento se negato |
|---|---|
| `CAMERA` | App **bloccata**: schermata esplicativa con invito ad abilitare il permesso dalle impostazioni di sistema |
| `ACCESS_FINE_LOCATION` (+ `ACCESS_COARSE_LOCATION` fallback) | Scatto **silenzioso** senza geotag, nessun avviso all'utente |
| `RECORD_AUDIO` | Necessario solo per note vocali/dettatura; se negato, disabilitare le due opzioni nota corrispondenti, "Scrivi" resta sempre disponibile |

Nessun permesso storage classico richiesto (`WRITE_EXTERNAL_STORAGE`/`READ_MEDIA_IMAGES` superflui grazie a SAF).

---

## 17. Robustezza operativa

- **Scrittura atomica file**: sempre temp file → verifica → rename/copy nella destinazione SAF finale, mai scrittura diretta che potrebbe lasciare file corrotti in caso di crash/interruzione
- **Avviso spazio disco basso**: controllo storage disponibile (es. `StatFs` sulla partizione di destinazione) prima/periodicamente durante una sessione di scatto prolungata
- **Schermo sempre acceso** (`FLAG_KEEP_SCREEN_ON`) durante l'uso attivo della schermata camera
- **Numerazione progressiva foto** per progetto (`photoIndex`), calcolata atomicamente in transazione Room per evitare collisioni con scatti ravvicinati

---

## 18. Esplicitamente fuori scope (non richiesto)

- Nessun export/report (PDF, ecc.) — solo trasferimento file grezzi via USB/MTP
- Nessun account esterno, nessun login, nessun backend/cloud sync
- Nessun watermark/logo aziendale nell'overlay
- Nessuna ricerca full-text avanzata (Room FTS) — volume atteso non lo giustifica, `LIKE` è sufficiente
- Nessun supporto RAW/DNG, nessuna estensione HDR CameraX
- Nessun wiping forense/sicuro alla cancellazione (limite intrinseco dello storage flash moderno, non implementabile in modo affidabile)

---

## 19. Note per l'implementazione (prossimi passi)

1. Scaffolding Gradle: version catalog (`libs.versions.toml`) con le versioni indicate in §2
2. Package skeleton come da §3
3. Manifest: permessi runtime elencati in §16, nessun permesso storage classico
4. Implementare prima la pipeline di scatto end-to-end (§6) su un singolo progetto hardcoded, poi aggiungere gestione multi-progetto/SAF picker
5. Verificare comportamento `ExifInterface` in scrittura su file descriptor ottenuto da SAF `DocumentFile` (alcuni provider non garantiscono fd seekable in "rw" — storage locale e SD standard lo supportano, ma va testato sul device target reale)
6. Il modulo `security/` (hash+firma Keystore) può essere sviluppato e testato in isolamento prima di integrarlo nella pipeline di scatto
