# kube-auth-proxy

[![NPM version](https://badge.fury.io/js/kube-auth-proxy.svg)](https://npmjs.org/package/kube-auth-proxy)
![Build Status](https://github.com/jwalton/kube-auth-proxy.svg)
[![Coverage Status](https://coveralls.io/repos/jwalton/kube-auth-proxy/badge.svg)](https://coveralls.io/r/jwalton/kube-auth-proxy)

Securely expose your private Kubernetes services.

## BETA

This project is very beta. We're using it in production, but this is undergoing
active development, and may change quite a bit without warning.

## Description

kube-auth-proxy is a Kubernetes-aware authorizing reverse proxy, designed as
a replacement for oauth2_proxy.

You may have a number of "internal" services, such as Prometheus, Grafana,
Kibana, the Kubernetes dashboard, or others, which you'd like to make available
on the public internet, but which you'd like to control who can access.
kube-auth-proxy tries to make this a fairly painless process.

The basic idea is:

- Install kube-auth-proxy. Configure it with some default authentication and
  authorization.
- Set up an ingress controller which forwards one or more subdomains to kube-auth-proxy
  (e.g. "\*.internal.mydomain.com").
- For each service you want to expose, either add some annotations to that service
  or create a configmap for the service which desicribes what domain it should
  be available on (e.g. "prometheus.internal.mydomain.com" or just "prometheus"),
  and optionally specify some extra authorization criteria for this service.

## Tutorial

Let's suppose we have an internal service in our cluster, say prometheus, and
we want to expose it at prom.internal.mydomain.com.

### Pick a Domain Name

We're going to expose all your internal services under a single domain name.
For example, if you pick "internal.MY-DOMAIN.COM", then when you expose the
Kubernetes dashboard you might put it under "dashboard.internal.MY-DOMAIN.COM".

GitHub wants a single domain name to use for OAuth callbacks (we'll use
auth.internal.MY-DOMAIN.COM in this example), which means when we set a cookie,
we're going to set it for some parent of that domain, which in turn means we're
going to put all our other services under that same domain.

### Create a Github Oauth App

Go to your GitHub organization, click on "Settings" then pick "OAuth Apps" on
the left. Click the "New OAuth App" button in the upper right corner. In
the "Authorization callback URL", put
`http://auth.internal.MY-DOMAIN.COM/kube-auth-proxy/github/callback`. Fill in
the rest of these fields however you like. When you create your app, take note
of the client ID and client secret; you'll need these in the next step.

### Installation and Configuration

Start with `examples/kube-auth-proxy-github.yaml`. Download this file, and update
(at a minimum) `internal.MY-DOMAIN.COM`, `CLIENT-ID-HERE`, `CLIENT-SECRET-HERE`,
and `MY-ORG-HERE`. Apply this with:

```sh
$ kubectl apply -f `./kube-auth-proxy-github.yaml`.
```

### Define an Ingress

We need to create an ingress which forwards "\*.internal.MY-DOMAN.COM" to our
new service. Unlike with oauth2-proxy or other services, kube-auth-proxy doesn't
rely on features built into nginx-ingress, and should work with any ingress,
include the ALB ingress or with Traefik. For example, on AWS an ALB ingress
could be as simple as:

```yaml
apiVersion: extensions/v1beta1
kind: Ingress
metadata:
  name: kube-auth-proxy-ingress
  namespace: kube-system
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTPS":443}]'
    alb.ingress.kubernetes.io/scheme: internet-facing
spec:
  rules:
    - host: '*.internal.MY-DOMAIN.COM'
      http:
        paths:
          - path: /*
            backend:
              serviceName: kube-auth-proxy
              servicePort: http
```

This will create an ALB listening for https traffic on 443, and will forward all
traffic to kube-auth-proxy. We need to set up DNS and certificates, but again,
this is dependent on your specific setup. On AWS if you're using external-dns,
it will configure your A-Records for you in Route 53.

### Annotate our Internal Service

We'll add some annotations to our service so kube-auth-proxy will find it and route to it:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: prometheus
  labels:
    app: prometheus
  annotations:
    # Expose this as prometheus.internal.MY-DOMAIN.COM
    kube-auth-proxy/host: prometheus
    # Forward traffic to Prometheus service's "web" port.
    kube-auth-proxy/targetPort: web
    # Only allow github users in the "devOps" team in the "MY-ORG-HERE"
    # organization to access this service.
    kube-auth-proxy/githubAllowedTeams: devOps@MY-ORG-HERE
spec:
  type: ClusterIP
  ports:
    - name: web
      port: 9090
      protocol: TCP
      targetPort: 9090
  selector:
    app: prometheus
```

That's all you need to do! As soon as you create/update this service,
kube-auth-proxy will update it's internal configuration and start forwarding
traffic to your internal service. Only Github authenticated users will
be able to connect.

## Service Annotations

- `kube-auth-proxy/host` - The hostname to assign to the service. This can
  either be just the hostname (e.g. "prometheus") in which case it will combined
  the configured domain (e.g. "prometheus.mycompany.org"), or it can be a FQDN
  (e.g. "promethus.mycompany.org".)
- `kube-auth-proxy/targetPort` - The port to forward traffic to. This can either
  be the name of a port in the service's `ports` section, or it can be a numeric
  port.
- `kube-auth-proxy/protocol` - The protocol to use to communicate with the
  back end - "http" or "https". Defaults to "http".
- `kube-auth-proxy/validateCertificate` - If "protocol" is https, and this is
  "false", then kube-auth-proxy will not validate the target service's certificate.
  Defaults to "true".
- `kube-auth-proxy/bearerTokenSecret` - A reference to a secret, used to populate
  a bearer token header when requests are sent to the target service. For example:

        kube-auth-proxy/bearerTokenSecret: "{secretName: 'mysecret', dataName: 'token'}"

  would find the secret "mysecret" in the same namespace as the service, extract
  value "token", and inject this as a bearer token in an "Authorization"
  header for all requests forwarded to the service. You can also specify a
  `secretRegex` in place of `secretName`, in which case the first secret found
  which matches the regex will be used. This is handy for tokens created by a
  ServiceAccount.

- `kube-auth-proxy/basicAuthUsername` - A username to send in basic auth
  credentials to the target. If `kube-auth-proxy/basicAuthPasswordSecret` or
  `kube-auth-proxy/basicAuthPassword` is not present, this will be ignored.
- `kube-auth-proxy/basicAuthPasswordSecret` - A reference to a secret, used
  to send basic auth credentials to the target. For example:

        kube-auth-proxy/basicAuthPasswordSecret: "{secretName: 'mysecret', dataName: 'password'}"

- `kube-auth-proxy/basicAuthPassword` - A password to send in basic auth
  credentials to the target. In general you should prefer
  `kube-auth-proxy/basicAuthPasswordSecret` over this.

### Conditions

Note that if more than one condition is defined, they are "or"ed together.
In other words, if you specify:

```yaml
annotations:
  kube-auth-proxy/githubAllowedOrganizations: myorg
  kube-auth-proxy/githubAllowedUsers: jwalton
```

then the github user "jwalton" will be allowed to access your service, and anyone
in "myorg" will also be able to access your service (as opposed to the more
restrictive "and" case where only users with the name "jwalton" who are also
members of "myorg" will be allowed to access you service).

- `kube-auth-proxy/githubAllowedOrganizations` - A comma delimited list of
  organization names. Any user who is a member of one of these organizations
  will be allowed to access your service. e.g. "github,benbria". Note that
  this is not case sensitive.
- `kube-auth-proxy/githubAllowedTeams` - A comma delimited list of github
  teams allowed to access this service. Team names are specified as `team@org`.
  For example, if your organization was named "benbria", and you had two teams
  called "dev" and "ops", you could grant access to both these teams with
  "dev@benbria,ops@benbria". Note that this is not case sensitive.
- `kube-auth-proxy/githubAllowedUsers` - A comma delimited list of github
  users allowed to access this service. Note that this is not case sensitive.

## Configuring Services with ProxyTarget CRDs

Adding annotations to services is the preferred way to configure kube-auth-proxy,
but sometimes it is impractical - for example perhaps you have a service
you've installed via helm, and the helm chart doesn't give you an easy way to
add annotations to the service.

In these cases, you can configure services using a ProxyTarget CRD. First,
install the CRD:

````sh
$ kubectl apply -f https://raw.githubusercontent.com/jwalton/kube-auth-proxy/master/crds/kube-auth-proxy-proxy-target-crd.yaml
``

You can restrict which proxy targets will be considered in the config file using
label selectors:

```yaml
proxyTargetSelector:
  matchLabels:
    type: kube-auth-proxy-config
````

This make it so kube-auth-proxy will actively watch secrets and configmaps with
the label "kube-auth-proxy-config". It will load all data inside any such
configmap or secret found, and try to parse it as a YAML config file. Here's
an example config file for the kubernetes dashboard:

```yaml
apiVersion: kube-auth-proxy.thedreaming.org/v1beta1
kind: ProxyTarget
metadata:
  name: rabbit-mq
  labels:
    type: kube-auth-proxy-config
target:
  host: dashboard
  to:
    service: kubernetes-dashboard
    targetPort: 443
    protocol: https
    validateCertificate: false
  bearerTokenSecret:
    secretRegex: '^kubernetes-dashboard-token.*$'
    dataName: 'token'
  conditions:
    githubAllowedTeams:
      - devOps@MY-ORG-HERE
```

Inside a `target`, you can use (almost) any annotation you could use on a service
(minus the "kube-auth-proxy/" prefix). Condition annotations must be in the
"conditions" section. In addition, you must specify a `to` which must
either be a `{targetUrl}` or a `{service, targetPort, namespace?}` object.

## Run locally in minikube

```sh
$ eval $(minikube docker-env)
$ docker build --target release --tag jwalton/kube-auth-proxy .
$ eval $(minikube docker-env -u)
$ kubectl apply -f ./examples/kube-auth-proxy-minikube.yaml
$ kubectl --namespace kube-system port-forward svc/kube-auth-proxy 5050:5050
```

And then visit [http://localhost:5050](http://localhost:5050).

Copyright 2019 Jason Walton
