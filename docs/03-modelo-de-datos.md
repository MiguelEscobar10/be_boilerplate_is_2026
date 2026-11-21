# Modelo de datos

Sale de [`prisma/schema.prisma`](../prisma/schema.prisma): 18 tablas en
PostgreSQL 18, creadas por 23 migraciones. `PK` es la llave primaria, `FK`
una llave foránea y `UK` un valor único. Las relaciones `||--o|` son de 1 a
0..1 y las `||--o{` de 1 a muchos.

Las reglas que viven en la base (CHECK, índices únicos parciales, triggers,
funciones de consulta y extensiones) están en
[modelo-de-datos.md](modelo-de-datos.md), y el detalle de cada tabla, con sus
decisiones, en el documento de su módulo en [`modulos/`](modulos/).

## Diagrama entidad-relación

```mermaid
erDiagram
    users {
        string id PK
        string email UK
        string password_hash
        boolean is_active
        UserRole role
        timestamp created_at
        timestamp updated_at
    }
    user_profiles {
        string id PK
        string user_id FK, UK
        string name
        string phone
        timestamp created_at
        timestamp updated_at
    }
    refresh_tokens {
        string id PK
        string token_hash UK
        string user_id FK
        timestamp expires_at
        timestamp revoked_at
        timestamp created_at
    }
    notifications {
        string id PK
        string user_id FK
        ModuloOrigen source_module
        string title
        string message
        string reference_type
        string reference_id
        timestamp read_at
        timestamp created_at
    }
    listings {
        string id PK
        string landlord_id FK
        ListingType type
        string name
        string description
        string location
        decimal rate_amount
        RateUnit rate_unit
        decimal deposit_amount
        string conditions
        boolean is_active
        boolean requires_verification
        timestamp created_at
    }
    listing_images {
        string id PK
        string listing_id FK
        string path
        int position
        timestamp created_at
    }
    reservations {
        string id PK
        string listing_id FK
        string tenant_id FK
        timestamp start_at
        timestamp end_at
        ReservationStatus status
        decimal rental_cost
        decimal deposit_amount
        timestamp created_at
        timestamp decided_at
        string decided_by FK
        string rejection_reason
    }
    availability_blocks {
        string id PK
        string listing_id FK
        timestamp start_at
        timestamp end_at
        string reason
        string created_by FK
        timestamp created_at
    }
    simulated_payments {
        string id PK
        string reservation_id FK
        decimal total_amount
        decimal rental_cost
        decimal deposit_amount
        SimulatedPaymentStatus status
        string card_last4
        string rejection_reason
        int attempt_number
        timestamp created_at
    }
    deliveries {
        string id PK
        string reservation_id FK, UK
        timestamp delivered_at
        string initial_condition_note
        string registered_by FK
    }
    delivery_photos {
        string id PK
        string delivery_id FK
        string path
        int position
        timestamp created_at
    }
    returns {
        string id PK
        string reservation_id FK, UK
        timestamp returned_at
        ReturnFinalState final_state
        string observations
        string damages
        string registered_by FK
        timestamp created_at
    }
    deposit_resolutions {
        string id PK
        string reservation_id FK, UK
        decimal original_deposit
        decimal retained_amount
        decimal released_amount
        DepositStatus status
        string reason
        timestamp resolved_at
    }
    conversations {
        string id PK
        string listing_id FK
        string tenant_id FK
        string landlord_id FK
        string reservation_id FK, UK
        timestamp created_at
    }
    messages {
        string id PK
        string conversation_id FK
        string author_id FK
        string content
        timestamp created_at
    }
    tenant_ratings {
        string id PK
        string reservation_id FK, UK
        string author_id FK
        string tenant_id FK
        int score
        string comment
        timestamp created_at
    }
    listing_landlord_ratings {
        string id PK
        string reservation_id FK, UK
        string author_id FK
        string listing_id FK
        string landlord_id FK
        int listing_score
        int landlord_score
        string comment
        timestamp created_at
    }
    identity_verifications {
        string id PK
        string user_id FK
        string document_key
        IdentityVerificationStatus status
        string rejection_reason
        string reviewed_by FK
        timestamp reviewed_at
        timestamp submitted_at
    }
    users ||--o| user_profiles : "perfil"
    users ||--o{ refresh_tokens : "sesiones"
    users ||--o{ notifications : "recibe"
    users ||--o{ listings : "publica (landlord)"
    listings ||--o{ listing_images : "fotos"
    listings ||--o{ reservations : "se reserva"
    users ||--o{ reservations : "solicita (tenant)"
    users ||--o{ reservations : "decide (decidedBy)"
    listings ||--o{ availability_blocks : "bloqueos"
    users ||--o{ availability_blocks : "crea (createdBy)"
    reservations ||--o{ simulated_payments : "intentos de pago"
    reservations ||--o| deliveries : "entrega"
    users ||--o{ deliveries : "registra"
    deliveries ||--o{ delivery_photos : "fotos"
    reservations ||--o| returns : "devolución"
    users ||--o{ returns : "registra"
    reservations ||--o| deposit_resolutions : "garantía"
    listings ||--o{ conversations : "sobre"
    users ||--o{ conversations : "tenant"
    users ||--o{ conversations : "landlord"
    reservations ||--o| conversations : "conversación"
    conversations ||--o{ messages : "mensajes"
    users ||--o{ messages : "escribe"
    reservations ||--o| tenant_ratings : "calificación"
    users ||--o{ tenant_ratings : "author"
    users ||--o{ tenant_ratings : "tenant"
    reservations ||--o| listing_landlord_ratings : "calificación"
    users ||--o{ listing_landlord_ratings : "author"
    listings ||--o{ listing_landlord_ratings : "listing"
    users ||--o{ listing_landlord_ratings : "landlord"
    users ||--o{ identity_verifications : "envía"
    users ||--o{ identity_verifications : "revisa (reviewedBy)"
```

**Enums**

- `UserRole`: ARRENDADOR, ARRENDATARIO, REVISOR
- `ListingType`: EQUIPO, ESPACIO
- `RateUnit`: HORA, DIA, NOCHE, SEMANA
- `ReservationStatus`: PENDIENTE, CONFIRMADA, RECHAZADA, CANCELADA, EN_CURSO, COMPLETADA
- `SimulatedPaymentStatus`: PENDIENTE, APROBADO, RECHAZADO
- `ReturnFinalState`: SIN_OBSERVACIONES, CON_OBSERVACIONES
- `DepositStatus`: LIBERADA, RETENIDA
- `IdentityVerificationStatus`: PENDIENTE, APROBADA, RECHAZADA
- `ModuloOrigen`: CATALOGO, BUSQUEDA, RESERVAS, PAGOS_GARANTIA, MENSAJERIA, RESENAS, VERIFICACION, NOTIFICACIONES, REPORTES

## Tablas

| Tabla | Descripción | Campos importantes |
|---|---|---|
| `users` | Cuenta de acceso, de la cátedra, con el rol agregado ([cuentas](modulos/cuentas.md)) | `email` único y normalizado, `password_hash` (bcrypt), `is_active`, `role` (por defecto ARRENDATARIO) |
| `user_profiles` | Datos visibles de la cuenta, uno por usuario ([cuentas](modulos/cuentas.md)) | `user_id` único, `name` (hasta 100), `phone` (8 a 15 dígitos) |
| `refresh_tokens` | Sesiones abiertas para renovar el access token | `token_hash` (SHA-256), `expires_at`, `revoked_at` |
| `notifications` | Bandeja de avisos de cada usuario ([notificaciones](modulos/notificaciones.md)) | `user_id`, `source_module`, `title`, `message`, `reference_type` y `reference_id`, `read_at` (nulo = no leída) |
| `listings` | Equipo o espacio publicado por un arrendador ([catalogo](modulos/catalogo.md)) | `landlord_id`, `type`, `rate_amount` y `rate_unit`, `deposit_amount`, `is_active`, `requires_verification` |
| `listing_images` | Fotos de una publicación, en orden ([catalogo](modulos/catalogo.md)) | `listing_id`, `path` privado, `position` única por publicación |
| `reservations` | Solicitud y reserva de un bien en un período ([reservas](modulos/reservas.md)) | `listing_id`, `tenant_id`, `start_at` y `end_at`, `status`, `rental_cost` y `deposit_amount` fotografiados, `decided_by`, `rejection_reason` |
| `availability_blocks` | Fechas que el arrendador bloquea en un bien propio ([reservas](modulos/reservas.md)) | `listing_id`, `start_at` y `end_at`, `reason` opcional, `created_by` |
| `simulated_payments` | Intentos de pago simulado de una reserva, hasta 3 ([pagos](modulos/pagos.md)) | `reservation_id`, `attempt_number` único por reserva, `status`, `total_amount`, `card_last4` (solo los últimos 4 dígitos), `rejection_reason` |
| `deliveries` | Entrega del bien que inicia el alquiler ([entregas](modulos/entregas.md)) | `reservation_id` único, `delivered_at`, `initial_condition_note`, `registered_by` |
| `delivery_photos` | Fotos del estado inicial en la entrega ([entregas](modulos/entregas.md)) | `delivery_id`, `path` privado, `position` única por entrega |
| `returns` | Devolución del bien ([devoluciones](modulos/devoluciones.md)) | `reservation_id` único, `returned_at`, `final_state`, `damages`, `registered_by` |
| `deposit_resolutions` | Resolución simulada de la garantía, que cierra la reserva ([devoluciones](modulos/devoluciones.md)) | `reservation_id` único, `original_deposit`, `retained_amount`, `released_amount`, `status`, `reason` |
| `conversations` | Conversación entre arrendatario y arrendador, antes de reservar o de una reserva ([mensajeria](modulos/mensajeria.md)) | `listing_id`, `tenant_id`, `landlord_id`, `reservation_id` único y opcional |
| `messages` | Mensajes de una conversación ([mensajeria](modulos/mensajeria.md)) | `conversation_id`, `author_id`, `content` (hasta 1000 caracteres) |
| `tenant_ratings` | Calificación del arrendador al arrendatario ([resenas](modulos/resenas.md)) | `reservation_id` único, `author_id`, `tenant_id`, `score` de 1 a 5, `comment` |
| `listing_landlord_ratings` | Calificación del arrendatario al bien y al arrendador ([resenas](modulos/resenas.md)) | `reservation_id` único, `listing_id`, `landlord_id`, `listing_score` y `landlord_score` de 1 a 5, `comment` |
| `identity_verifications` | Solicitudes de verificación de identidad ([verificacion](modulos/verificacion.md)) | `user_id`, `document_key` privado, `status`, `reviewed_by`, `reviewed_at`, `rejection_reason` |
