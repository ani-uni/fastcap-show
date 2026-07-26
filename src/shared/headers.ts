import pkg from '@/package.json'

class HeadersClass {
  static readonly app = new Headers({
    'User-Agent': `ani-uni/${pkg.name}`,
  })
  get idn(): 'app' {
    return 'app'
  }
  get(idn: 'app') {
    return HeadersClass[idn]
  }
}

export const headers = new HeadersClass()
