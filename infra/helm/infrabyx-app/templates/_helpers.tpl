{{/* Names and labels (IPB-01 §01.4.8.2). */}}
{{- define "infrabyx-app.name" -}}
{{- printf "%s-%s" .Release.Name .Values.app.kind | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "infrabyx-app.labels" -}}
app.kubernetes.io/name: {{ include "infrabyx-app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: {{ .Values.app.kind }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
infrabyx.dev/env: {{ .Values.env.name }}
{{- end -}}

{{- define "infrabyx-app.selector" -}}
app.kubernetes.io/name: {{ include "infrabyx-app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Kinds that serve HTTP to other services and get a Service. */}}
{{- define "infrabyx-app.served" -}}
{{- if ne .Values.app.kind "worker" -}}true{{- end -}}
{{- end -}}

{{/* Next.js kinds that need a writable .next/cache. */}}
{{- define "infrabyx-app.next" -}}
{{- if has .Values.app.kind (list "web" "public" "console") -}}true{{- end -}}
{{- end -}}

{{/*
Refusals the chart enforces at render time, whatever the values say:
- IPB-ENV-001: a seed profile in prod, dr or pre-prod (SEED_REFUSED_ENVS, PL1-D-06; @IPB-01-AT-12);
- IPB-ENV-002: a Supabase host from staging upwards (IPB-01 §01.4.11);
- IPB-ENV-003: a plain variable whose name says it is a secret from staging upwards (IPB-02-28).
*/}}
{{- define "infrabyx-app.validate" -}}
{{- $env := .Values.env.name -}}
{{- if and .Values.seed.profile (has $env (list "prod" "dr" "pre-prod")) -}}
{{- fail (printf "IPB-ENV-001: seed profile %q refused in %s (seeds never run in prod, dr or pre-prod)" .Values.seed.profile $env) -}}
{{- end -}}
{{- $upper := has $env (list "staging" "demo" "pre-prod" "prod" "dr") -}}
{{- range $k, $v := .Values.env.vars -}}
{{- if and $upper (contains ".supabase.co" (lower $v)) -}}
{{- fail (printf "IPB-ENV-002: %s points at a Supabase host, refused in %s (IPB-01 §01.4.11)" $k $env) -}}
{{- end -}}
{{- if and $upper (regexMatch "(PASSWORD|SECRET|TOKEN|PRIVATE_KEY|API_KEY|_KEY)$" $k) -}}
{{- fail (printf "IPB-ENV-003: %s looks like a secret; in %s secrets come through the SECRETS port, never env (IPB-02-28)" $k $env) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/* The locked pod and container security contexts (not configurable). */}}
{{- define "infrabyx-app.podSecurity" -}}
runAsNonRoot: true
runAsUser: 10001
runAsGroup: 10001
fsGroup: 10001
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "infrabyx-app.containerSecurity" -}}
runAsNonRoot: true
runAsUser: 10001
runAsGroup: 10001
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
privileged: false
capabilities:
  drop: ["ALL"]
{{- end -}}

{{/* The image reference: repository@digest, never a tag. */}}
{{- define "infrabyx-app.image" -}}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest -}}
{{- end -}}

{{/* Plain environment shared by the app and the migration job. */}}
{{- define "infrabyx-app.env" -}}
- name: NODE_ENV
  value: production
- name: APP_ENV
  value: {{ .Values.env.name | quote }}
- name: PORT
  value: {{ .Values.app.port | quote }}
- name: HOSTNAME
  value: "0.0.0.0"
- name: ROUTING_FILE
  value: /etc/infrabyx/routing/routing.yaml
{{- if .Values.otel.endpoint }}
- name: OTEL_EXPORTER_OTLP_ENDPOINT
  value: {{ .Values.otel.endpoint | quote }}
- name: OTEL_TRACES_SAMPLER
  value: parentbased_traceidratio
- name: OTEL_TRACES_SAMPLER_ARG
  value: {{ .Values.otel.samplingRatio | quote }}
{{- end }}
{{- if .Values.seed.profile }}
- name: SEED_PROFILE
  value: {{ .Values.seed.profile | quote }}
{{- end }}
{{- range $k, $v := .Values.env.vars }}
- name: {{ $k }}
  value: {{ $v | quote }}
{{- end }}
{{- end -}}

{{/* Volumes every pod mounts: writable /tmp, the routing file and the secrets CSI mount. */}}
{{- define "infrabyx-app.volumes" -}}
- name: tmp
  emptyDir:
    sizeLimit: 256Mi
{{- if include "infrabyx-app.next" . }}
- name: next-cache
  emptyDir:
    sizeLimit: 512Mi
{{- end }}
- name: routing
  configMap:
    name: {{ .Values.routing.configMap }}
{{- if .Values.secrets.provider }}
- name: secrets
  csi:
    driver: secrets-store.csi.k8s.io
    readOnly: true
    volumeAttributes:
      secretProviderClass: {{ include "infrabyx-app.name" . }}
{{- end }}
{{- end -}}

{{- define "infrabyx-app.mounts" -}}
- name: tmp
  mountPath: /tmp
{{- if include "infrabyx-app.next" . }}
- name: next-cache
  mountPath: /app/.next/cache
{{- end }}
- name: routing
  mountPath: /etc/infrabyx/routing
  readOnly: true
{{- if .Values.secrets.provider }}
- name: secrets
  mountPath: /mnt/secrets
  readOnly: true
{{- end }}
{{- end -}}
