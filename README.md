# Gittrends-app - Geocoder

`@gittrends-app/geocoder` é uma biblioteca e aplicação para resolução de endereços informados por desenvolvedores da plataforma GitHub.

Esse script é necessário uma vez que as localizações informadas são livres, ou seja, cada usuário informa um texto em formato próprio (e.g., Brasil, brazil, br, etc.).

Para isso usamos do [Nominatim](https://nominatim.openstreetmap.org/), uma search engine do OpenStreetMap, para resolver a localização provida em um local padronizado (país, estado, cidade, etc.).

Também suportamos provedores comerciais como LocationIQ. O provedor LocationIQ exige uma chave de API — exporte a variável de ambiente LOCATIONIQ_KEY ou passe o apiKey ao construir o serviço.

## Instalação

```bash
# Como dependência no seu projeto (via GitHub)
npm install gittrends-app/geocoder
# ou
yarn add gittrends-app/geocoder

# Ou usar diretamente via npx (via GitHub)
npx gittrends-app/geocoder
```

## Como usar

### Como biblioteca

```typescript
import { OpenStreetMap, Cache } from 'geocoder';

// Criar instância do geocoder
const geocoder = new Cache(new OpenStreetMap({
  server: 'https://nominatim.openstreetmap.org',
  email: 'seu-email@example.com'
}));

// Resolver localização
const result = await geocoder.geocode('brazil');
console.log(result); // { country: "Brazil", country_code: "BR", ... }
```

### Como servidor (CLI)

```bash
# Executar via npx (do GitHub)
npx gittrends-app/geocoder --port 3000

# Ou com Docker
docker build github.com/gittrends-app/geocoder -t gittrends/geocoder
docker run --rm -p 3000:80 gittrends/geocoder
```

Esta aplicação cria um servidor local que permite a consulta por outros clients usando do protocolo REST.

Após executar o servidor, você poderá consultar localizações fazendo requisições para `/search?q=<localização>`. Por exemplo:

```console
curl http://localhost:3000/search?q=brazil
```

A resposta será:

```json
{ "source": "brazil", "country": "Brazil", "country_code": "BR" }
```

Ou acessar <http://localhost:3000/docs> para navegar pela documentação Swagger do projeto.

## Cache de resultados

Com intuito de otimizar o uso das requisições da API, a aplicação faz uso de uma base que armazena os resultados de consultas anteriores. Assim, antes de realizar a consulta aos serviços externos, a aplicação verifica se a localização já foi resolvida anteriormente. Em caso positivo, ele reutiliza os resultados obtidos. Caso contrário, realiza a consulta a API. Essa abordagem permite acelerar o processo usando de resultados locais.

## Desenvolvimento

### Release

Este projeto usa `release-it` para automação de releases:

```bash
# Fazer novo release
yarn release

# O release-it irá:
# - Executar lint e testes
# - Incrementar a versão
# - Criar commit e tag
# - Fazer push para GitHub
# - Criar GitHub Release
```

**Nota:** O pacote não é publicado no npm, apenas disponibilizado via GitHub.

## Autores

- Hudson Silva Borges ([github](https://github.com/hsborges))
